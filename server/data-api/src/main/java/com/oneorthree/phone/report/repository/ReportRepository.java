package com.oneorthree.phone.report.repository;

import com.oneorthree.phone.report.dto.ReportRequest;
import com.oneorthree.phone.report.dto.ReportReceipt;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 신고 진술의 저장소. 목록은 서비스 자격으로 보호된 운영 표면에서만 사용한다. */
@Repository
@RequiredArgsConstructor
public class ReportRepository {
    private final JdbcTemplate jdbc;

    public List<Map<String, Object>> findRequest(UUID userId, UUID requestId) {
        return jdbc.queryForList("SELECT * FROM safety_reports WHERE reporter_id = ? AND request_id = ?",
                userId, requestId);
    }

    public long countRecent(UUID userId, Instant since) {
        return jdbc.queryForObject("SELECT count(*) FROM safety_reports WHERE reporter_id = ? AND received_at > ?",
                Long.class, userId, Timestamp.from(since));
    }

    public ReportReceipt insert(UUID id, UUID reporter, ReportRequest body, Instant now) {
        // PostgreSQL timestamptz 정밀도에 맞춰 최초 응답과 재시도 응답을 동일하게 유지한다.
        Instant receivedAt = now.truncatedTo(ChronoUnit.MICROS);
        jdbc.update("INSERT INTO safety_reports (id, reporter_id, request_id, target_type, target_id, target_user_id,"
                        + " reason, details, submitted_text, received_at, status, legal_hold)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', false)",
                id, reporter, body.requestId(), body.targetType(), body.targetId(), body.targetUserId(),
                body.reason(), body.details(), body.submittedText(), Timestamp.from(receivedAt));
        return new ReportReceipt(id, receivedAt);
    }

    public List<Map<String, Object>> pending(UUID cursor) {
        return jdbc.queryForList("SELECT * FROM safety_reports WHERE status IN ('OPEN', 'REVIEWING')"
                + " AND (CAST(? AS uuid) IS NULL OR id > ?) ORDER BY id LIMIT 100", cursor, cursor);
    }

    public int close(UUID id, String status, String note, String actor, Instant now) {
        return jdbc.update("UPDATE safety_reports SET status = ?, resolution = ?, resolved_by = ?, closed_at = ?"
                + " WHERE id = ? AND closed_at IS NULL", status, note, actor, Timestamp.from(now), id);
    }

    public int purgeClosed(Instant before) {
        return jdbc.update("DELETE FROM safety_reports WHERE closed_at < ? AND legal_hold = false",
                Timestamp.from(before));
    }
}

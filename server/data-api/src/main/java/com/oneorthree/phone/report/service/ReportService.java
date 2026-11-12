package com.oneorthree.phone.report.service;

import com.oneorthree.phone.common.exception.RateLimitedException;
import com.oneorthree.phone.common.id.UuidV7;
import com.oneorthree.phone.report.dto.ReportRequest;
import com.oneorthree.phone.report.dto.ReportReceipt;
import com.oneorthree.phone.report.exception.ReportErrorCode;
import com.oneorthree.phone.report.exception.ReportException;
import com.oneorthree.phone.report.repository.ReportRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** 게스트도 접수할 수 있다. 신고 건수만으로 숨김이나 제재를 확정하지 않는다. */
@Service
@RequiredArgsConstructor
public class ReportService {
    private static final Set<String> TARGETS = Set.of("USER", "LETTER", "ISLAND_MESSAGE", "NOTICE",
            "NOTICE_COMMENT", "GUESTBOOK", "ISLAND", "OTHER");
    private static final Set<String> REASONS = Set.of("HARASSMENT", "HATE", "SPAM_FRAUD", "SEXUAL",
            "CHILD_SAFETY", "THREAT", "PRIVACY_IMPERSONATION", "OTHER");
    private final ReportRepository reports;

    /** 내부 조합 계층이 사용자·현재 세션을 잠그고 검증한 TX 안에서만 접수한다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public ReportReceipt submit(UUID reporterId, ReportRequest body) {
        validate(body);
        var existing = reports.findRequest(reporterId, body.requestId());
        if (!existing.isEmpty()) {
            Map<String, Object> row = existing.get(0);
            if (!Objects.equals(row.get("target_type"), body.targetType())
                    || !Objects.equals(row.get("target_id"), body.targetId())
                    || !Objects.equals(row.get("target_user_id"), body.targetUserId())
                    || !Objects.equals(row.get("reason"), body.reason())
                    || !Objects.equals(row.get("details"), body.details())
                    || !Objects.equals(row.get("submitted_text"), body.submittedText())) {
                throw new ReportException(ReportErrorCode.REPORT_KEY_REUSED);
            }
            return new ReportReceipt((UUID) row.get("id"), ((Timestamp) row.get("received_at")).toInstant());
        }
        Instant now = Instant.now();
        if (reports.countRecent(reporterId, now.minus(1, ChronoUnit.HOURS)) >= 20) {
            throw new RateLimitedException(3_600_000);
        }
        return reports.insert(UuidV7.next(), reporterId, body, now);
    }

    public List<Map<String, Object>> pending(UUID cursor) {
        return reports.pending(cursor);
    }

    @Transactional
    public void close(UUID id, String status, String resolution, String actor) {
        if (!Set.of("RESOLVED", "DISMISSED").contains(status == null ? "" : status)
                || resolution == null || resolution.isBlank() || resolution.length() > 2000
                || actor == null || actor.isBlank()) {
            throw new ReportException(ReportErrorCode.REPORT_INVALID);
        }
        if (reports.close(id, status, resolution, actor, Instant.now()) != 1) {
            throw new ReportException(ReportErrorCode.REPORT_CLOSED);
        }
    }

    private void validate(ReportRequest b) {
        if (b == null || b.requestId() == null || !TARGETS.contains(b.targetType() == null ? "" : b.targetType())
                || !REASONS.contains(b.reason() == null ? "" : b.reason())
                || b.details() == null || b.details().isBlank() || b.details().length() > 2000
                || b.details().indexOf('\0') >= 0
                || (b.submittedText() != null && (b.submittedText().length() > 5000
                    || b.submittedText().indexOf('\0') >= 0))
                || (!"OTHER".equals(b.targetType()) && b.targetId() == null)) {
            throw new ReportException(ReportErrorCode.REPORT_INVALID);
        }
    }
}

package com.oneorthree.phone.report;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.report.dto.ReportRequest;
import com.oneorthree.phone.report.exception.ReportException;
import com.oneorthree.phone.report.service.ReportService;
import com.oneorthree.phone.report.repository.ReportRepository;
import java.time.Instant;
import com.oneorthree.phone.report.scheduler.ReportRetention;
import com.oneorthree.phone.common.exception.RateLimitedException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 PostgreSQL과 운영 Flyway에서 접수·멱등·한도·파기를 검증한다. */
@SpringBootTest
class ReportIntakeIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired private AuthService auth;
    @Autowired private JwtProvider jwt;
    @Autowired private ReportService reports;
    @Autowired private ReportRepository repository;
    @Autowired private ReportRetention retention;
    @Autowired private JdbcTemplate jdbc;

    private UUID user() {
        return jwt.extractUserId(auth.guestSession(UUID.randomUUID().toString()).accessToken());
    }

    private ReportRequest request(UUID key) {
        return new ReportRequest(key, "OTHER", null, null, "HARASSMENT", "신고자의 진술", "인용한 텍스트");
    }

    @Test
    void guestCanSubmitAndRetryWithoutDuplicatingOrReadingOtherReporters() {
        UUID caller = user();
        var body = request(UUID.randomUUID());
        var receipt = reports.submit(caller, body);
        assertThat(reports.submit(caller, body)).isEqualTo(receipt);
        assertThat(reports.submit(user(), body).reportId()).isNotEqualTo(receipt.reportId());
        assertThatThrownBy(() -> reports.submit(caller, new ReportRequest(body.requestId(), "OTHER", null, null,
                "HATE", body.details(), body.submittedText()))).isInstanceOf(ReportException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM safety_reports WHERE reporter_id = ?",
                Integer.class, caller)).isEqualTo(1);
    }

    @Test
    void nanosecondReceiptMatchesStoredTimestampOnRetry() {
        UUID caller = user();
        var body = request(UUID.randomUUID());
        var receipt = repository.insert(UUID.randomUUID(), caller, body,
                Instant.parse("2026-11-12T00:00:00.123456789Z"));
        assertThat(receipt.receivedAt()).isEqualTo(Instant.parse("2026-11-12T00:00:00.123456Z"));
        assertThat(reports.submit(caller, body)).isEqualTo(receipt);
    }

    @Test
    void rateLimitDoesNotRejectRetryAndInvalidTargetsAreRejected() {
        UUID caller = user();
        var first = request(UUID.randomUUID());
        reports.submit(caller, first);
        for (int i = 1; i < 20; i++) {
            reports.submit(caller, request(UUID.randomUUID()));
        }
        assertThat(reports.submit(caller, first)).isNotNull();
        assertThatThrownBy(() -> reports.submit(caller, request(UUID.randomUUID())))
                .isInstanceOf(RateLimitedException.class);
        assertThatThrownBy(() -> reports.submit(user(), new ReportRequest(UUID.randomUUID(), "LETTER", null, null,
                "HATE", "내용", null))).isInstanceOf(ReportException.class);
    }

    @Test
    void closeAndRetentionPreservePendingAndLegalHoldAndDoNotExtendClosure() {
        UUID caller = user();
        var closed = reports.submit(caller, request(UUID.randomUUID()));
        var pending = reports.submit(caller, request(UUID.randomUUID()));
        var held = reports.submit(caller, request(UUID.randomUUID()));
        reports.close(closed.reportId(), "DISMISSED", "위반 확인 어려움", "member-1");
        reports.close(held.reportId(), "RESOLVED", "운영 조치 기록 참조", "member-1");
        assertThatThrownBy(() -> reports.close(closed.reportId(), "DISMISSED", "중복 종결", "member-1"))
                .isInstanceOf(ReportException.class);
        jdbc.update("UPDATE safety_reports SET closed_at = now() - interval '31 days' WHERE id IN (?, ?)",
                closed.reportId(), held.reportId());
        jdbc.update("UPDATE safety_reports SET legal_hold = true, hold_reason = '적법한 보존 요청 확인' WHERE id = ?",
                held.reportId());
        retention.purge();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM safety_reports WHERE id = ?", Integer.class,
                closed.reportId())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM safety_reports WHERE id IN (?, ?)", Integer.class,
                pending.reportId(), held.reportId())).isEqualTo(2);
    }
}

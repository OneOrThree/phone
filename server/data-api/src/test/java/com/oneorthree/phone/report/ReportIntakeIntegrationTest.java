package com.oneorthree.phone.report;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthService.LoginSessionResult;
import com.oneorthree.phone.auth.service.SessionLogoutService;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.internal.dto.ReportSubmissionRequest;
import com.oneorthree.phone.internal.service.InternalReportService;
import com.oneorthree.phone.report.dto.ReportReceipt;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.Future;
import java.time.Duration;
import java.util.List;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
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
@AutoConfigureMockMvc
class ReportIntakeIntegrationTest {
    private static final String TOKEN = "test-report-business-to-data";
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST /internal/users/*/reports");
    }

    @Autowired private AuthService auth;
    @Autowired private JwtProvider jwt;
    @Autowired private ReportService reports;
    @Autowired private ReportRepository repository;
    @Autowired private ReportRetention retention;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private InternalReportService intake;
    @Autowired private SessionLogoutService logout;
    @Autowired private MockMvc mvc;
    @Autowired private PlatformTransactionManager transactions;

    private Actor user() {
        var login = auth.guestSession(UUID.randomUUID().toString());
        return new Actor(jwt.extractUserId(login.accessToken()), jwt.extractSessionId(login.accessToken()),
                jwt.extractAuthGeneration(login.accessToken()), login);
    }

    private ReportReceipt submit(Actor actor, ReportRequest body) {
        return intake.submit(actor.id(), new ReportSubmissionRequest(actor.sessionId(), actor.generation(), body));
    }

    private record Actor(UUID id, UUID sessionId, Long generation, LoginSessionResult login) {
    }

    private ReportRequest request(UUID key) {
        return new ReportRequest(key, "OTHER", null, null, "HARASSMENT", "신고자의 진술", "인용한 텍스트");
    }

    @Test
    void guestCanSubmitAndRetryWithoutDuplicatingOrReadingOtherReporters() {
        var caller = user();
        var body = request(UUID.randomUUID());
        var receipt = submit(caller, body);
        assertThat(submit(caller, body)).isEqualTo(receipt);
        assertThat(submit(user(), body).reportId()).isNotEqualTo(receipt.reportId());
        assertThatThrownBy(() -> submit(caller, new ReportRequest(body.requestId(), "OTHER", null, null,
                "HATE", body.details(), body.submittedText()))).isInstanceOf(ReportException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM safety_reports WHERE reporter_id = ?",
                Integer.class, caller.id())).isEqualTo(1);
    }

    @Test
    void nanosecondReceiptMatchesStoredTimestampOnRetry() {
        var caller = user();
        var body = request(UUID.randomUUID());
        var receipt = repository.insert(UUID.randomUUID(), caller.id(), body,
                Instant.parse("2026-11-12T00:00:00.123456789Z"));
        assertThat(receipt.receivedAt()).isEqualTo(Instant.parse("2026-11-12T00:00:00.123456Z"));
        assertThat(submit(caller, body)).isEqualTo(receipt);
    }

    @Test
    void rateLimitDoesNotRejectRetryAndInvalidTargetsAreRejected() {
        var caller = user();
        var first = request(UUID.randomUUID());
        submit(caller, first);
        for (int i = 1; i < 20; i++) {
            submit(caller, request(UUID.randomUUID()));
        }
        assertThat(submit(caller, first)).isNotNull();
        assertThatThrownBy(() -> submit(caller, request(UUID.randomUUID())))
                .isInstanceOf(RateLimitedException.class);
        assertThatThrownBy(() -> submit(user(), new ReportRequest(UUID.randomUUID(), "LETTER", null, null,
                "HATE", "내용", null))).isInstanceOf(ReportException.class);
    }

    @Test
    void closeAndRetentionPreservePendingAndLegalHoldAndDoNotExtendClosure() {
        var caller = user();
        var closed = submit(caller, request(UUID.randomUUID()));
        var pending = submit(caller, request(UUID.randomUUID()));
        var held = submit(caller, request(UUID.randomUUID()));
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

    @Test
    void internalRouteCarriesSessionProofAndRejectsLoggedOutRequests() throws Exception {
        var caller = user();
        String body = "{\"sessionId\":\"" + caller.sessionId() + "\",\"authGeneration\":" + caller.generation()
                + ",\"report\":{\"requestId\":\"" + UUID.randomUUID()
                + "\",\"targetType\":\"OTHER\",\"reason\":\"OTHER\",\"details\":\"신고 내용\"}}";
        String path = "/internal/users/" + caller.id() + "/reports";
        mvc.perform(post(path).header("Authorization", "Bearer " + TOKEN).header("X-User-Id", caller.id())
                        .contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.reportId").isString());
        logout.logout(caller.login().refreshToken(), caller.login().accessToken());
        mvc.perform(post(path).header("Authorization", "Bearer " + TOKEN).header("X-User-Id", caller.id())
                        .contentType("application/json").content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SESSION_NOT_ACTIVE"));
    }

    @Test
    void revokedMissingForeignAndStaleSessionCannotCreateOrReplay() {
        var caller = user();
        var other = user();
        var body = request(UUID.randomUUID());
        submit(caller, body);
        for (var proof : List.of(
                new ReportSubmissionRequest(null, caller.generation(), body),
                new ReportSubmissionRequest(caller.sessionId(), null, body),
                new ReportSubmissionRequest(other.sessionId(), caller.generation(), body),
                new ReportSubmissionRequest(caller.sessionId(), caller.generation() + 1, body))) {
            assertThatThrownBy(() -> intake.submit(caller.id(), proof))
                    .isInstanceOf(AuthException.class).extracting("errorCode")
                    .isEqualTo(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
        logout.logout(caller.login().refreshToken(), caller.login().accessToken());
        assertThatThrownBy(() -> submit(caller, body)).isInstanceOf(AuthException.class);
        assertThatThrownBy(() -> submit(caller, request(UUID.randomUUID()))).isInstanceOf(AuthException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM safety_reports WHERE reporter_id = ?",
                Integer.class, caller.id())).isEqualTo(1);
        assertThat(submit(other, request(UUID.randomUUID()))).isNotNull();
    }

    @Test
    void concurrentLogoutPreventsWaitingReportFromCommitting() throws Exception {
        var caller = user();
        var executor = Executors.newSingleThreadExecutor();
        var started = new CountDownLatch(1);
        var pid = new AtomicInteger();
        var follower = new AtomicReference<Future<?>>();
        var tx = new TransactionTemplate(transactions);
        try {
            tx.executeWithoutResult(status -> {
                logout.logout(caller.login().refreshToken(), caller.login().accessToken());
                follower.set(executor.submit(() -> tx.executeWithoutResult(other -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    submit(caller, request(UUID.randomUUID()));
                })));
                try {
                    assertThat(started.await(20, TimeUnit.SECONDS)).isTrue();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError(e);
                }
                awaitDatabaseLock(pid.get());
            });
            assertThatThrownBy(() -> follower.get().get(20, TimeUnit.SECONDS)).hasCauseInstanceOf(AuthException.class);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM safety_reports WHERE reporter_id = ?",
                    Integer.class, caller.id())).isZero();
        } finally {
            executor.shutdownNow();
        }
    }

    private void awaitDatabaseLock(int pid) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (Boolean.TRUE.equals(jdbc.queryForObject("select cardinality(pg_blocking_pids(?)) > 0",
                    Boolean.class, pid))) {
                return;
            }
            Thread.onSpinWait();
        }
        throw new AssertionError("실제 PostgreSQL 행 잠금 대기가 관측되지 않았습니다.");
    }
}

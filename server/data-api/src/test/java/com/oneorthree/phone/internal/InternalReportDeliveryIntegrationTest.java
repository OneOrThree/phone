package com.oneorthree.phone.internal;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.internal.dto.ReportDeliveryClaimRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryPrepareRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryView;
import com.oneorthree.phone.internal.service.InternalReportDeliveryService;
import com.oneorthree.phone.user.repository.ReportDeliveryPrivacyRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.internal.exception.ReportDeliveryErrorCode;
import com.oneorthree.phone.internal.exception.ReportDeliveryException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;
import java.sql.Timestamp;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 운영 PostgreSQL 제약과 row/advisory lock 위에서 신고 전달 lease를 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
class InternalReportDeliveryIntegrationTest {

    private static final String FINGERPRINT = "a".repeat(64);
    private static final String TOKEN = "test-report-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]",
                () -> "POST /internal/users/*/report-deliveries/*/claim");
        registry.add("internal.api.callers.business.allow[1]",
                () -> "POST /internal/users/*/report-deliveries/*/prepare");
        registry.add("internal.api.callers.business.allow[2]",
                () -> "POST /internal/users/*/report-deliveries/*/renew");
        registry.add("internal.api.callers.business.allow[3]",
                () -> "POST /internal/users/*/report-deliveries/*/email-confirmed");
        registry.add("internal.api.callers.business.allow[4]",
                () -> "POST /internal/users/*/report-deliveries/*/complete");
        registry.add("internal.api.callers.business.allow[5]",
                () -> "POST /internal/users/*/report-deliveries/*/release");
    }

    @Autowired
    InternalReportDeliveryService deliveries;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;
    @Autowired
    ReportDeliveryPrivacyRepository privacy;

    @Test
    void sameRequestIsLeasedOnceAndDifferentPayloadIsRejected() {
        UUID reporter = newUser();
        UUID requestId = UUID.randomUUID();
        ReportDeliveryView first = deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, false));

        assertThat(first.status()).isEqualTo("PENDING");
        assertThat(first.leaseToken()).isNotNull();
        assertThat(first.confirmationToken()).isNotNull();
        assertThatThrownBy(() -> deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, false)))
                .isInstanceOfSatisfying(ReportDeliveryException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(ReportDeliveryErrorCode.REQUEST_IN_PROGRESS));

        deliveries.release(reporter, requestId, first.leaseToken());
        assertThatThrownBy(() -> deliveries.claim(reporter, requestId, claim(requestId, "b".repeat(64), false)))
                .isInstanceOfSatisfying(ReportDeliveryException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(ReportDeliveryErrorCode.IDEMPOTENCY_KEY_REUSED));
        assertThat(jdbc.queryForObject("select count(*) from report_deliveries where reporter_id=?",
                Long.class, reporter)).isEqualTo(1L);

        UUID otherRequest = UUID.randomUUID();
        ReportDeliveryView other = deliveries.claim(reporter, otherRequest,
                claim(otherRequest, "c".repeat(64), false));
        assertThat(other.confirmationToken()).isNotEqualTo(first.confirmationToken());
    }

    @Test
    void preparedSnapshotSurvivesRetryAndCompletedReceiptReplaysWithoutPii() {
        UUID reporter = newUser();
        UUID requestId = UUID.randomUUID();
        UUID author = newUser();
        ReportDeliveryView first = deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, true));
        deliveries.prepare(reporter, requestId,
                new ReportDeliveryPrepareRequest(first.leaseToken(), author, "신고 제목", "서버 원문"));
        deliveries.release(reporter, requestId, first.leaseToken());

        ReportDeliveryView resumed = deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, true));
        assertThat(resumed.authorId()).isEqualTo(author);
        assertThat(resumed.subject()).isEqualTo("신고 제목");
        assertThat(resumed.body()).isEqualTo("서버 원문");

        ReportDeliveryView confirmed = deliveries.emailConfirmed(reporter, requestId, resumed.leaseToken());
        assertThat(confirmed.status()).isEqualTo("EMAIL_CONFIRMED");
        assertThat(confirmed.body()).isNull();
        ReportDeliveryView completed = deliveries.complete(reporter, requestId, resumed.leaseToken(), true);
        assertThat(completed.status()).isEqualTo("COMPLETED");
        assertThat(completed.blocked()).isTrue();
        assertThat(deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, true))).isEqualTo(completed);
        assertThat(jdbc.queryForObject("select mail_body from report_deliveries where reporter_id=?",
                String.class, reporter)).isNull();
    }

    @Test
    void expiredLeaseIsTakenOverAndEveryOldTokenMutationIsFenced() {
        UUID reporter = newUser();
        UUID requestId = UUID.randomUUID();
        UUID author = newUser();
        ReportDeliveryView old = deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, true));
        deliveries.prepare(reporter, requestId,
                new ReportDeliveryPrepareRequest(old.leaseToken(), author, "제목", "개인정보 원문"));
        jdbc.update("update report_deliveries set lease_expires_at=? where reporter_id=? and request_id=?",
                Timestamp.from(Instant.now().minusSeconds(1)), reporter, requestId);

        ReportDeliveryView current = deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, true));
        assertThat(current.leaseToken()).isNotEqualTo(old.leaseToken());
        assertThatThrownBy(() -> deliveries.prepare(reporter, requestId,
                new ReportDeliveryPrepareRequest(old.leaseToken(), author, "제목", "개인정보 원문")))
                .isInstanceOf(ReportDeliveryException.class);
        assertThatThrownBy(() -> deliveries.renew(reporter, requestId, old.leaseToken()))
                .isInstanceOf(ReportDeliveryException.class);
        assertThatThrownBy(() -> deliveries.emailConfirmed(reporter, requestId, old.leaseToken()))
                .isInstanceOf(ReportDeliveryException.class);
        assertThatThrownBy(() -> deliveries.complete(reporter, requestId, old.leaseToken(), true))
                .isInstanceOf(ReportDeliveryException.class);
        deliveries.release(reporter, requestId, old.leaseToken());

        assertThat(jdbc.queryForObject("select lease_token from report_deliveries where reporter_id=? and request_id=?",
                UUID.class, reporter, requestId)).isEqualTo(current.leaseToken());
        assertThat(deliveries.emailConfirmed(reporter, requestId, current.leaseToken()).status())
                .isEqualTo("EMAIL_CONFIRMED");
    }

    @Test
    void controllerFilterAndEveryWorkflowActionAreWired() throws Exception {
        UUID reporter = newUser();
        UUID author = newUser();
        UUID requestId = UUID.randomUUID();
        String base = "/internal/users/" + reporter + "/report-deliveries/" + requestId;
        String claimBody = "{\"fingerprint\":\"" + FINGERPRINT + "\",\"caseId\":\"GR-" + requestId
                + "\",\"blockRequested\":false}";
        String claimed = mvc.perform(post(base + "/claim")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", reporter)
                        .contentType(MediaType.APPLICATION_JSON).content(claimBody))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String lease = JsonPath.read(claimed, "$.leaseToken");
        String leaseBody = "{\"leaseToken\":\"" + lease + "\"}";

        mvc.perform(post(base + "/prepare")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", reporter)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"leaseToken\":\"" + lease
                                + "\",\"authorId\":\"" + author
                                + "\",\"subject\":\"제목\",\"body\":\"원문\"}"))
                .andExpect(status().isOk());
        mvc.perform(post(base + "/renew").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", reporter).contentType(MediaType.APPLICATION_JSON).content(leaseBody))
                .andExpect(status().isOk());
        mvc.perform(post(base + "/email-confirmed").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", reporter).contentType(MediaType.APPLICATION_JSON).content(leaseBody))
                .andExpect(status().isOk());
        mvc.perform(post(base + "/complete").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", reporter).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"leaseToken\":\"" + lease + "\",\"blocked\":false}"))
                .andExpect(status().isOk());
        mvc.perform(post(base + "/release").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", reporter).contentType(MediaType.APPLICATION_JSON).content(leaseBody))
                .andExpect(status().isNoContent());

        mvc.perform(post(base + "/claim").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                        .content(claimBody))
                .andExpect(status().isForbidden());
    }

    @Test
    void prepareRejectsWithdrawalThatHappenedAfterEvidenceReadWithoutSavingSnapshot() {
        UUID reporter = newUser();
        UUID author = newUser();
        UUID requestId = UUID.randomUUID();
        ReportDeliveryView claimed = deliveries.claim(reporter, requestId,
                claim(requestId, FINGERPRINT, false));
        jdbc.update("update users set is_deleted=true where id=?", author);

        assertThatThrownBy(() -> deliveries.prepare(reporter, requestId,
                new ReportDeliveryPrepareRequest(claimed.leaseToken(), author, "제목", "탈퇴 전 원문")))
                .isInstanceOf(RuntimeException.class);
        assertThat(jdbc.queryForObject("select mail_body from report_deliveries where reporter_id=? and request_id=?",
                String.class, reporter, requestId)).isNull();
    }

    @Test
    void staleSnapshotsArePurgedAndWithdrawalDeletesInvolvingRows() {
        UUID reporter = newUser();
        UUID requestId = UUID.randomUUID();
        UUID author = newUser();
        ReportDeliveryView pending = deliveries.claim(reporter, requestId, claim(requestId, FINGERPRINT, true));
        deliveries.prepare(reporter, requestId,
                new ReportDeliveryPrepareRequest(pending.leaseToken(), author, "제목", "회신메일과 원문"));
        jdbc.update("update report_deliveries set updated_at=now()-interval '25 hours' where reporter_id=?",
                reporter);

        assertThat(privacy.purgeStale()).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForMap("select status, author_id, mail_body from report_deliveries "
                        + "where reporter_id=? and request_id=?", reporter, requestId))
                .containsEntry("status", "EXPIRED")
                .containsEntry("author_id", null)
                .containsEntry("mail_body", null);

        UUID secondRequest = UUID.randomUUID();
        ReportDeliveryView second = deliveries.claim(reporter, secondRequest,
                claim(secondRequest, "b".repeat(64), true));
        deliveries.prepare(reporter, secondRequest,
                new ReportDeliveryPrepareRequest(second.leaseToken(), author, "제목", "원문"));
        jdbc.update("update report_deliveries set lease_expires_at=now()-interval '1 second' "
                + "where reporter_id=? and request_id=?", reporter, secondRequest);
        privacy.eraseForWithdrawal(author);
        assertThat(jdbc.queryForObject("select count(*) from report_deliveries where reporter_id=?",
                Long.class, reporter)).isEqualTo(2L);
        assertThat(jdbc.queryForObject("select status from report_deliveries where reporter_id=? and request_id=?",
                String.class, reporter, secondRequest)).isEqualTo("EXPIRED");

        UUID thirdRequest = UUID.randomUUID();
        ReportDeliveryView third = deliveries.claim(reporter, thirdRequest,
                claim(thirdRequest, "c".repeat(64), true));
        deliveries.prepare(reporter, thirdRequest,
                new ReportDeliveryPrepareRequest(third.leaseToken(), author, "제목", "원문"));
        deliveries.emailConfirmed(reporter, thirdRequest, third.leaseToken());
        privacy.eraseForWithdrawal(author);
        ReportDeliveryView receipt = deliveries.claim(reporter, thirdRequest,
                claim(thirdRequest, "c".repeat(64), true));
        assertThat(receipt.status()).isEqualTo("COMPLETED");
        assertThat(receipt.blocked()).isFalse();
    }

    @Test
    void activePendingLeaseSurvivesWithdrawalCleanupUntilConfirmationIsRecorded() {
        UUID reporter = newUser();
        UUID author = newUser();
        UUID requestId = UUID.randomUUID();
        ReportDeliveryView pending = deliveries.claim(reporter, requestId,
                claim(requestId, "d".repeat(64), true));
        deliveries.prepare(reporter, requestId,
                new ReportDeliveryPrepareRequest(pending.leaseToken(), author, "제목", "원문"));

        privacy.eraseForWithdrawal(author);

        assertThat(jdbc.queryForMap("select status, lease_token from report_deliveries "
                        + "where reporter_id=? and request_id=?", reporter, requestId))
                .containsEntry("status", "PENDING")
                .containsEntry("lease_token", pending.leaseToken());
        deliveries.emailConfirmed(reporter, requestId, pending.leaseToken());
        privacy.eraseForWithdrawal(author);

        ReportDeliveryView receipt = deliveries.claim(reporter, requestId,
                claim(requestId, "d".repeat(64), true));
        assertThat(receipt.status()).isEqualTo("COMPLETED");
        assertThat(receipt.blocked()).isFalse();
    }

    private ReportDeliveryClaimRequest claim(UUID requestId, String fingerprint, boolean block) {
        return new ReportDeliveryClaimRequest(fingerprint, "GR-" + requestId, block);
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }
}

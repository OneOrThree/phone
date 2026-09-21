package com.oneorthree.phone.auth.repository.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 전환 시도의 순수 도메인 전이 계약 (GROMO-1992 · V101 {@code ck_login_attempts_switch_state}).
 *
 * <p>DB 없이 엔티티만으로 검증한다 — 같은 모양을 DB 가 다시 거절하는지는
 * {@code LoginAttemptSwitchRepositoryTest} 가 본다. 핵심은 두 가지다: ① 같은 여섯 증거의
 * 재진입만 멱등이고 하나라도 다르면 fail-closed, ② INVALIDATED 는 증거를 지우고
 * phase/confirmed 만 종료 표지로 남긴다.
 */
class LoginAttemptSwitchTransitionTest {

    private static final Instant NOW = Instant.parse("2026-09-21T12:00:00Z");
    private static final UUID SOURCE_USER = UUID.fromString("11111111-0000-0000-0000-000000001992");
    private static final UUID SOURCE_SESSION = UUID.fromString("22222222-0000-0000-0000-000000001992");
    private static final UUID TARGET_USER = UUID.fromString("33333333-0000-0000-0000-000000001992");
    private static final UUID TARGET_SOCIAL = UUID.fromString("44444444-0000-0000-0000-000000001992");
    private static final Instant VERIFIED_AT = Instant.parse("2026-09-21T12:01:00Z");

    private LoginAttempt pending(boolean confirmed) {
        return LoginAttempt.builder()
                .attemptId(UUID.randomUUID()).status(LoginAttemptStatus.PENDING)
                .digestKeyId("key-id").credentialDigest("digest")
                .provider("APPLE").credentialKind("id_token").termsVersion("2026-09")
                .accountSwitchConfirmed(confirmed)
                .claimedAt(NOW).recoveryExpiresAt(NOW.plus(Duration.ofMinutes(5)))
                .build();
    }

    private LoginAttempt verified() {
        LoginAttempt attempt = pending(true);
        attempt.verifySwitch(SOURCE_USER, SOURCE_SESSION, 7, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT);
        return attempt;
    }

    private LoginTokenMaterials materials() {
        return new LoginTokenMaterials(false, 7L,
                NOW, NOW.plusSeconds(3600), NOW, NOW.plusSeconds(2_592_000), UUID.randomUUID());
    }

    @Test
    @DisplayName("builder 기본값 — confirmed=false + phase·증거 전부 null (legacy 행 모양)")
    void legacyBuilderDefaultsToUnconfirmedAndNoPhase() {
        LoginAttempt attempt = pending(false);

        assertThat(attempt.isAccountSwitchConfirmed()).isFalse();
        assertThat(attempt.getSwitchPhase()).isNull();
        assertThat(attempt.getSwitchSourceUserId()).isNull();
        assertThat(attempt.getSwitchSourceSessionId()).isNull();
        assertThat(attempt.getSwitchSourceAuthGeneration()).isNull();
        assertThat(attempt.getSwitchTargetUserId()).isNull();
        assertThat(attempt.getSwitchTargetSocialAccountId()).isNull();
        assertThat(attempt.getSwitchVerifiedAt()).isNull();
    }

    @Test
    @DisplayName("PENDING + confirmed 시도가 여섯 증거와 함께 VERIFIED 로 전이한다")
    void confirmedPendingVerifiesWithExactEvidence() {
        LoginAttempt attempt = verified();

        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(attempt.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
        assertThat(attempt.getSwitchSourceSessionId()).isEqualTo(SOURCE_SESSION);
        assertThat(attempt.getSwitchSourceAuthGeneration()).isEqualTo(7);
        assertThat(attempt.getSwitchTargetUserId()).isEqualTo(TARGET_USER);
        assertThat(attempt.getSwitchTargetSocialAccountId()).isEqualTo(TARGET_SOCIAL);
        assertThat(attempt.getSwitchVerifiedAt()).isEqualTo(VERIFIED_AT);
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
    }

    @Test
    @DisplayName("같은 증거의 VERIFIED 재호출은 no-op")
    void sameVerifiedTransitionIsIdempotent() {
        LoginAttempt attempt = verified();

        attempt.verifySwitch(SOURCE_USER, SOURCE_SESSION, 7, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT);

        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(attempt.getSwitchVerifiedAt()).isEqualTo(VERIFIED_AT);
    }

    @Test
    @DisplayName("GUEST_WITHDRAWN 뒤 같은 증거의 재검증은 no-op — 과거 단계로 되돌리지 않는다")
    void verifiedReentryAfterGuestWithdrawnDoesNotRegress() {
        LoginAttempt attempt = verified();
        attempt.markGuestWithdrawn();

        attempt.verifySwitch(SOURCE_USER, SOURCE_SESSION, 7, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT);

        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
    }

    @Test
    @DisplayName("하나라도 다른 증거의 재진입은 fail-closed")
    void changedSourceOrTargetOnReentryFailsClosed() {
        LoginAttempt attempt = verified();

        assertThatThrownBy(() -> attempt.verifySwitch(
                UUID.randomUUID(), SOURCE_SESSION, 7, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> attempt.verifySwitch(
                SOURCE_USER, SOURCE_SESSION, 8, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> attempt.verifySwitch(
                SOURCE_USER, SOURCE_SESSION, 7, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT.plusSeconds(1)))
                .isInstanceOf(IllegalStateException.class);
        // 거절돼도 저장된 증거는 그대로다.
        assertThat(attempt.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
        assertThat(attempt.getSwitchSourceAuthGeneration()).isEqualTo(7);
    }

    @Test
    @DisplayName("GUEST_WITHDRAWN 재호출은 no-op 이고 증거를 건드리지 않는다")
    void guestWithdrawnTransitionIsIdempotent() {
        LoginAttempt attempt = verified();
        attempt.markGuestWithdrawn();

        attempt.markGuestWithdrawn();

        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(attempt.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
        assertThat(attempt.getSwitchTargetUserId()).isEqualTo(TARGET_USER);
        assertThat(attempt.getSwitchVerifiedAt()).isEqualTo(VERIFIED_AT);
    }

    @Test
    @DisplayName("VERIFIED 를 거치지 않은 시도(phase null·미확정)는 GUEST_WITHDRAWN 이 불법")
    void guestWithdrawnWithoutVerifiedFails() {
        assertThatThrownBy(() -> pending(true).markGuestWithdrawn())
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> pending(false).markGuestWithdrawn())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("전환 시도는 VERIFIED 에서 완료할 수 없다 — GUEST_WITHDRAWN 을 거쳐야 한다")
    void switchCannotCompleteBeforeGuestWithdrawn() {
        LoginAttempt attempt = verified();

        assertThatThrownBy(() -> attempt.complete(
                TARGET_USER, UUID.randomUUID(), true, materials(), NOW))
                .isInstanceOf(IllegalStateException.class);
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);

        attempt.markGuestWithdrawn();
        attempt.complete(TARGET_USER, UUID.randomUUID(), true, materials(), NOW);

        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.COMPLETED);
        // 완료 뒤에도 증거는 보존된다 — recovery replay 검증이 그 값들을 요구한다.
        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(attempt.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
    }

    @Test
    @DisplayName("일반 시도(phase null)는 지금처럼 PENDING 에서 완료한다")
    void normalAttemptStillCompletesWithoutSwitchPhase() {
        LoginAttempt attempt = pending(false);

        attempt.complete(TARGET_USER, UUID.randomUUID(), true, materials(), NOW);

        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.COMPLETED);
        assertThat(attempt.getUserId()).isEqualTo(TARGET_USER);
    }

    @Test
    @DisplayName("COMPLETED·INVALIDATED 는 전환 전이를 모두 거절하고, 완료 재호출도 불법이다")
    void completedAndInvalidatedRejectFurtherSwitchTransitions() {
        LoginAttempt completed = verified();
        completed.markGuestWithdrawn();
        completed.complete(TARGET_USER, UUID.randomUUID(), true, materials(), NOW);

        assertThatThrownBy(() -> completed.verifySwitch(
                SOURCE_USER, SOURCE_SESSION, 7, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(completed::markGuestWithdrawn)
                .isInstanceOf(IllegalStateException.class);
        // 이미 COMPLETED 인 행의 재완료는 불법 — 같은 결과의 replay 는 메서드 재호출이 아니라 조회다.
        assertThatThrownBy(() -> completed.complete(
                TARGET_USER, UUID.randomUUID(), true, materials(), NOW))
                .isInstanceOf(IllegalStateException.class);

        LoginAttempt invalidated = verified();
        invalidated.invalidate();

        assertThatThrownBy(() -> invalidated.verifySwitch(
                SOURCE_USER, SOURCE_SESSION, 7, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(invalidated::markGuestWithdrawn)
                .isInstanceOf(IllegalStateException.class);
        // invalidate 재호출은 no-op 이다.
        invalidated.invalidate();
        assertThat(invalidated.getStatus()).isEqualTo(LoginAttemptStatus.INVALIDATED);
    }

    @Test
    @DisplayName("invalidate 는 여섯 증거를 지우고 phase·confirmed 만 종료 표지로 남긴다")
    void invalidateClearsSwitchEvidenceButPreservesTerminalMarker() {
        LoginAttempt attempt = verified();

        attempt.invalidate();

        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.INVALIDATED);
        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(attempt.isAccountSwitchConfirmed()).isTrue();
        assertThat(attempt.getSwitchSourceUserId()).isNull();
        assertThat(attempt.getSwitchSourceSessionId()).isNull();
        assertThat(attempt.getSwitchSourceAuthGeneration()).isNull();
        assertThat(attempt.getSwitchTargetUserId()).isNull();
        assertThat(attempt.getSwitchTargetSocialAccountId()).isNull();
        assertThat(attempt.getSwitchVerifiedAt()).isNull();
    }
}

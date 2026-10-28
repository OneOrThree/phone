package com.oneorthree.phone.auth.repository;

import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptStatus;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptSwitchPhase;
import com.oneorthree.phone.auth.repository.domain.LoginTokenMaterials;
import com.oneorthree.phone.common.support.RepositoryTestBase;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 전환 phase primitive 들의 쿼리 계약 (GROMO-1992) — {@code insertClaim(confirmed)},
 * {@code findByAttemptIdForUpdate}, {@code markSwitchGuestWithdrawn} 을 실제 PG 에 고정한다.
 * 서비스 배선은 아직 없다 — primitive 의 단독 계약만 검증한다.
 */
class LoginAttemptSwitchPhaseRepositoryTest extends RepositoryTestBase {

    private static final Instant NOW = Instant.parse("2026-09-21T12:00:00Z");
    private static final Instant LATER = Instant.parse("2026-09-21T12:02:00Z");
    private static final UUID SOURCE_USER = UUID.fromString("11111111-0000-0000-0000-000000001992");
    private static final UUID SOURCE_SESSION = UUID.fromString("22222222-0000-0000-0000-000000001992");
    private static final UUID TARGET_USER = UUID.fromString("33333333-0000-0000-0000-000000001992");
    private static final UUID TARGET_SOCIAL = UUID.fromString("44444444-0000-0000-0000-000000001992");
    private static final Instant VERIFIED_AT = Instant.parse("2026-09-21T12:01:00Z");

    @Autowired
    LoginAttemptRepository loginAttemptRepository;

    @PersistenceContext
    EntityManager entityManager;

    @Test
    @DisplayName("claim 은 confirmed 를 최초 값으로 박고 duplicate 는 바꾸지 않는다 — 8인자 호출은 false")
    void claimPinsConfirmedIntentOnce() {
        UUID confirmed = UUID.randomUUID();
        UUID unconfirmed = UUID.randomUUID();
        UUID legacy = UUID.randomUUID();

        assertThat(loginAttemptRepository.insertClaim(confirmed, "k", "d", "APPLE", "id_token",
                "2026-09", true, NOW, NOW.plus(Duration.ofMinutes(5)))).isEqualTo(1);
        assertThat(loginAttemptRepository.insertClaim(unconfirmed, "k", "d", "APPLE", "id_token",
                "2026-09", false, NOW, NOW.plus(Duration.ofMinutes(5)))).isEqualTo(1);
        // 기존 8인자 호출 — confirmed 를 모르는 호출부는 false 호환을 유지한다.
        assertThat(loginAttemptRepository.insertClaim(legacy, "k", "d", "APPLE", "id_token",
                "2026-09", NOW, NOW.plus(Duration.ofMinutes(5)))).isEqualTo(1);

        assertThat(loginAttemptRepository.findById(confirmed).orElseThrow()
                .isAccountSwitchConfirmed()).isTrue();
        assertThat(loginAttemptRepository.findById(unconfirmed).orElseThrow()
                .isAccountSwitchConfirmed()).isFalse();
        assertThat(loginAttemptRepository.findById(legacy).orElseThrow()
                .isAccountSwitchConfirmed()).isFalse();

        // duplicate 는 어느 방향이든 최초 claim 의 confirmed 를 바꾸지 않는다.
        assertThat(loginAttemptRepository.insertClaim(confirmed, "k", "d", "APPLE", "id_token",
                "2026-09", false, NOW, NOW.plus(Duration.ofMinutes(5)))).isZero();
        assertThat(loginAttemptRepository.insertClaim(unconfirmed, "k", "d", "APPLE", "id_token",
                "2026-09", true, NOW, NOW.plus(Duration.ofMinutes(5)))).isZero();
        assertThat(loginAttemptRepository.findById(confirmed).orElseThrow()
                .isAccountSwitchConfirmed()).isTrue();
        assertThat(loginAttemptRepository.findById(unconfirmed).orElseThrow()
                .isAccountSwitchConfirmed()).isFalse();
    }

    @Test
    @DisplayName("PENDING+VERIFIED 만 GUEST_WITHDRAWN 으로 정확히 1회 전이하고 증거는 보존된다")
    void guestWithdrawnTransitionIsConditionalAndOnce() {
        UUID verifiedId = loginAttemptRepository.save(verified()).getAttemptId();
        UUID plainPendingId = loginAttemptRepository.save(pending(false)).getAttemptId();
        LoginAttempt completedSwitch = verified();
        completedSwitch.markGuestWithdrawn();
        completedSwitch.complete(TARGET_USER, UUID.randomUUID(), true, materials(), NOW);
        UUID completedId = loginAttemptRepository.save(completedSwitch).getAttemptId();
        LoginAttempt invalidated = verified();
        invalidated.invalidate();
        UUID invalidatedId = loginAttemptRepository.save(invalidated).getAttemptId();

        // FOR UPDATE 조회 seam — 잠금 아래 읽은 뒤 조건부 UPDATE 로 전이한다.
        assertThat(loginAttemptRepository.findByAttemptIdForUpdate(verifiedId)).isPresent();
        assertThat(loginAttemptRepository.markSwitchGuestWithdrawn(verifiedId, LATER)).isEqualTo(1);
        // 재호출·다른 phase·다른 status 는 모두 0.
        assertThat(loginAttemptRepository.markSwitchGuestWithdrawn(verifiedId, LATER)).isZero();
        assertThat(loginAttemptRepository.markSwitchGuestWithdrawn(plainPendingId, LATER)).isZero();
        assertThat(loginAttemptRepository.markSwitchGuestWithdrawn(completedId, LATER)).isZero();
        assertThat(loginAttemptRepository.markSwitchGuestWithdrawn(invalidatedId, LATER)).isZero();

        entityManager.clear();

        LoginAttempt transitioned = loginAttemptRepository.findById(verifiedId).orElseThrow();
        assertThat(transitioned.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(transitioned.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(transitioned.getUpdatedAt()).isEqualTo(LATER);
        // 여섯 증거와 결과 칸은 UPDATE 가 건드리지 않는다.
        assertThat(transitioned.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
        assertThat(transitioned.getSwitchSourceSessionId()).isEqualTo(SOURCE_SESSION);
        assertThat(transitioned.getSwitchSourceAuthGeneration()).isEqualTo(7);
        assertThat(transitioned.getSwitchTargetUserId()).isEqualTo(TARGET_USER);
        assertThat(transitioned.getSwitchTargetSocialAccountId()).isEqualTo(TARGET_SOCIAL);
        assertThat(transitioned.getSwitchVerifiedAt()).isEqualTo(VERIFIED_AT);
        assertThat(transitioned.getUserId()).isNull();
        assertThat(transitioned.isAccountSwitchConfirmed()).isTrue();

        assertThat(loginAttemptRepository.findById(plainPendingId).orElseThrow().getSwitchPhase())
                .isNull();
        assertThat(loginAttemptRepository.findById(completedId).orElseThrow().getStatus())
                .isEqualTo(LoginAttemptStatus.COMPLETED);
        assertThat(loginAttemptRepository.findById(invalidatedId).orElseThrow().getStatus())
                .isEqualTo(LoginAttemptStatus.INVALIDATED);
    }

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
        return new LoginTokenMaterials(false, 9L,
                NOW, NOW.plusSeconds(3600), NOW, NOW.plusSeconds(2_592_000), UUID.randomUUID());
    }
}

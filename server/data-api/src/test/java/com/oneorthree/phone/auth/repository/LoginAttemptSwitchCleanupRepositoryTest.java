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
 * {@link LoginAttemptRepository#invalidateAndEraseOfUser} 의 전환 증거 파기 (GROMO-1992).
 *
 * <p>{@code ck_login_attempts_switch_state} 존재 자체는 {@code LoginAttemptSwitchRepositoryTest} 가
 * Flyway 체인 위에서 고정한다. 여기서는 create-drop 스키마 위 실제 PG 로 「결과 user_id 기준 파기가
 * phase·여섯 증거 열까지 지우고, source 열로는 넓어지지 않는다」는 쿼리 계약만 고정한다.
 */
class LoginAttemptSwitchCleanupRepositoryTest extends RepositoryTestBase {

    private static final Instant NOW = Instant.parse("2026-09-21T12:00:00Z");
    private static final UUID WITHDRAWN = UUID.fromString("55555555-0000-0000-0000-000000001992");
    private static final UUID OTHER_USER = UUID.fromString("66666666-0000-0000-0000-000000001992");
    private static final UUID GUEST_SOURCE = UUID.fromString("77777777-0000-0000-0000-000000001992");
    private static final UUID SOURCE_SESSION = UUID.fromString("22222222-0000-0000-0000-000000001992");
    private static final UUID TARGET_MEMBER = UUID.fromString("33333333-0000-0000-0000-000000001992");
    private static final UUID TARGET_SOCIAL = UUID.fromString("44444444-0000-0000-0000-000000001992");
    private static final Instant VERIFIED_AT = Instant.parse("2026-09-21T12:01:00Z");

    @Autowired
    LoginAttemptRepository loginAttemptRepository;

    @PersistenceContext
    EntityManager entityManager;

    @Test
    @DisplayName("탈퇴 파기는 결과 user_id 행만 INVALIDATED 하고 phase+여섯 증거까지 지운다 — source 진행 전환은 보존")
    void eraseScrubsSwitchEvidenceAndKeepsSourcePending() {
        UUID legacyId = loginAttemptRepository.save(completed(WITHDRAWN)).getAttemptId();
        UUID switchId = loginAttemptRepository.save(completedSwitch(WITHDRAWN)).getAttemptId();
        UUID otherId = loginAttemptRepository.save(completed(OTHER_USER)).getAttemptId();
        UUID pendingId = loginAttemptRepository.save(inProgressSwitchOf(WITHDRAWN)).getAttemptId();

        assertThat(loginAttemptRepository.invalidateAndEraseOfUser(WITHDRAWN, NOW)).isEqualTo(2);
        assertThat(loginAttemptRepository.invalidateAndEraseOfUser(WITHDRAWN, NOW)).isEqualTo(2);
        entityManager.clear();

        LoginAttempt legacy = loginAttemptRepository.findById(legacyId).orElseThrow();
        assertThat(legacy.getStatus()).isEqualTo(LoginAttemptStatus.INVALIDATED);
        assertThat(legacy.getCredentialDigest()).isNull();
        assertThat(legacy.getRefreshJti()).isNull();
        assertThat(legacy.getSwitchPhase()).isNull();

        LoginAttempt sw = loginAttemptRepository.findById(switchId).orElseThrow();
        assertThat(sw.getStatus()).isEqualTo(LoginAttemptStatus.INVALIDATED);
        assertThat(sw.getSwitchPhase()).isNull();
        assertThat(sw.getSwitchSourceUserId()).isNull();
        assertThat(sw.getSwitchSourceSessionId()).isNull();
        assertThat(sw.getSwitchSourceAuthGeneration()).isNull();
        assertThat(sw.getSwitchTargetUserId()).isNull();
        assertThat(sw.getSwitchTargetSocialAccountId()).isNull();
        assertThat(sw.getSwitchVerifiedAt()).isNull();
        // 최초 claim 표지는 남는다 — CHECK 첫째 절이 confirmed 를 제한하지 않는다.
        assertThat(sw.isAccountSwitchConfirmed()).isTrue();
        assertThat(sw.getUserId()).isEqualTo(WITHDRAWN);

        LoginAttempt other = loginAttemptRepository.findById(otherId).orElseThrow();
        assertThat(other.getStatus()).isEqualTo(LoginAttemptStatus.COMPLETED);
        assertThat(other.getCredentialDigest()).isEqualTo("digest");

        LoginAttempt pending = loginAttemptRepository.findById(pendingId).orElseThrow();
        assertThat(pending.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(pending.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(pending.getSwitchSourceUserId()).isEqualTo(WITHDRAWN);
        assertThat(pending.getSwitchSourceSessionId()).isEqualTo(SOURCE_SESSION);
        assertThat(pending.getSwitchTargetUserId()).isEqualTo(TARGET_MEMBER);
        assertThat(pending.getSwitchVerifiedAt()).isEqualTo(VERIFIED_AT);
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

    private LoginAttempt completed(UUID userId) {
        LoginAttempt attempt = pending(false);
        attempt.complete(userId, UUID.randomUUID(), true, materials(), NOW);
        return attempt;
    }

    private LoginAttempt completedSwitch(UUID userId) {
        LoginAttempt attempt = inProgressSwitchOf(GUEST_SOURCE);
        attempt.markGuestWithdrawn();
        attempt.complete(userId, UUID.randomUUID(), true, materials(), NOW);
        return attempt;
    }

    /** user_id 없이 source 로만 잡힌 진행 중 전환 — 파기 WHERE 가 source 열로 넓어지면 지워지는 행. */
    private LoginAttempt inProgressSwitchOf(UUID sourceUserId) {
        LoginAttempt attempt = pending(true);
        attempt.verifySwitch(sourceUserId, SOURCE_SESSION, 7, TARGET_MEMBER, TARGET_SOCIAL, VERIFIED_AT);
        return attempt;
    }

    private LoginTokenMaterials materials() {
        return new LoginTokenMaterials(false, 9L,
                NOW, NOW.plusSeconds(3600), NOW, NOW.plusSeconds(2_592_000), UUID.randomUUID());
    }
}

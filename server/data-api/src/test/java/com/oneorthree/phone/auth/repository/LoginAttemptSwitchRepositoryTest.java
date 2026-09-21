package com.oneorthree.phone.auth.repository;

import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptStatus;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptSwitchPhase;
import com.oneorthree.phone.auth.repository.domain.LoginTokenMaterials;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V101 스키마 위에서 {@link LoginAttempt} 의 round-trip 과 {@code ck_login_attempts_switch_state}
 * 의 DB 거절을 검증한다 (GROMO-1992).
 *
 * <p>{@code RepositoryTestBase}(ci 프로필의 create-drop)를 쓰지 «않는» 이유: create-drop 은
 * 엔티티 매핑에서 스키마를 만들므로 Flyway CHECK 가 존재하지 않는다. 여기서는 migration 테스트와
 * 같은 전용 컨테이너에 Flyway 전체 체인을 올리고, {@code hbm2ddl=validate} 로 엔티티 매핑이
 * 마이그레이션 스키마와 정확히 맞는지(드리프트 없는지)도 함께 고정한다.
 */
class LoginAttemptSwitchRepositoryTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 Flyway 체인과 create-drop 컨텍스트가 섞인다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final Instant NOW = Instant.parse("2026-09-21T12:00:00Z");
    private static final UUID SOURCE_USER = UUID.fromString("11111111-0000-0000-0000-000000001992");
    private static final UUID SOURCE_SESSION = UUID.fromString("22222222-0000-0000-0000-000000001992");
    private static final UUID TARGET_USER = UUID.fromString("33333333-0000-0000-0000-000000001992");
    private static final UUID TARGET_SOCIAL = UUID.fromString("44444444-0000-0000-0000-000000001992");
    private static final Instant VERIFIED_AT = Instant.parse("2026-09-21T12:01:00Z");

    private EntityManagerFactory emf;

    @BeforeEach
    void freshFlywaySchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();
        emf = entityManagerFactory();
    }

    @AfterEach
    void closeEmf() {
        if (emf != null) {
            emf.close();
        }
    }

    private EntityManagerFactory entityManagerFactory() {
        var factory = new LocalContainerEntityManagerFactoryBean();
        factory.setDataSource(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        factory.setManagedTypes(PersistenceManagedTypes.of(LoginAttempt.class.getName()));
        // validate — 엔티티 매핑이 Flyway 스키마와 어긋나면 여기서 부팅이 깨진다.
        factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "validate"));
        factory.afterPropertiesSet();
        return factory.getObject();
    }

    private UUID persist(LoginAttempt attempt) {
        try (EntityManager entityManager = emf.createEntityManager()) {
            var transaction = entityManager.getTransaction();
            transaction.begin();
            try {
                entityManager.persist(attempt);
                transaction.commit();
            } catch (RuntimeException | Error e) {
                if (transaction.isActive()) {
                    transaction.rollback();
                }
                throw e;
            }
        }
        return attempt.getAttemptId();
    }

    private LoginAttempt reload(UUID attemptId) {
        try (EntityManager entityManager = emf.createEntityManager()) {
            return entityManager.find(LoginAttempt.class, attemptId);
        }
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

    @Test
    @DisplayName("legacy builder 행은 persist/reload 시 confirmed=false + 전환 7열 null")
    void legacyRowRoundTripsAsUnconfirmed() {
        UUID id = persist(pending(false));

        LoginAttempt loaded = reload(id);
        assertThat(loaded.isAccountSwitchConfirmed()).isFalse();
        assertThat(loaded.getSwitchPhase()).isNull();
        assertThat(loaded.getSwitchSourceUserId()).isNull();
        assertThat(loaded.getSwitchSourceSessionId()).isNull();
        assertThat(loaded.getSwitchSourceAuthGeneration()).isNull();
        assertThat(loaded.getSwitchTargetUserId()).isNull();
        assertThat(loaded.getSwitchTargetSocialAccountId()).isNull();
        assertThat(loaded.getSwitchVerifiedAt()).isNull();
    }

    @Test
    @DisplayName("VERIFIED·GUEST_WITHDRAWN 행이 enum 과 8열을 그대로 round-trip 한다")
    void switchPhasesRoundTrip() {
        UUID verifiedId = persist(verified());

        LoginAttempt loadedVerified = reload(verifiedId);
        assertThat(loadedVerified.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(loadedVerified.isAccountSwitchConfirmed()).isTrue();
        assertThat(loadedVerified.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
        assertThat(loadedVerified.getSwitchSourceSessionId()).isEqualTo(SOURCE_SESSION);
        assertThat(loadedVerified.getSwitchSourceAuthGeneration()).isEqualTo(7);
        assertThat(loadedVerified.getSwitchTargetUserId()).isEqualTo(TARGET_USER);
        assertThat(loadedVerified.getSwitchTargetSocialAccountId()).isEqualTo(TARGET_SOCIAL);
        assertThat(loadedVerified.getSwitchVerifiedAt()).isEqualTo(VERIFIED_AT);

        LoginAttempt withdrawn = verified();
        withdrawn.markGuestWithdrawn();
        UUID withdrawnId = persist(withdrawn);

        LoginAttempt loadedWithdrawn = reload(withdrawnId);
        assertThat(loadedWithdrawn.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(loadedWithdrawn.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
    }

    @Test
    @DisplayName("switch COMPLETED 행은 재생 재료와 전환 증거가 함께 보존된다")
    void completedSwitchKeepsReplayMaterialsAndEvidence() {
        LoginAttempt attempt = verified();
        attempt.markGuestWithdrawn();
        LoginTokenMaterials materials = new LoginTokenMaterials(false, 9L,
                NOW, NOW.plusSeconds(3600), NOW, NOW.plusSeconds(2_592_000), UUID.randomUUID());
        UUID session = UUID.randomUUID();
        attempt.complete(TARGET_USER, session, true, materials, NOW);
        UUID id = persist(attempt);

        LoginAttempt loaded = reload(id);
        assertThat(loaded.getStatus()).isEqualTo(LoginAttemptStatus.COMPLETED);
        assertThat(loaded.getUserId()).isEqualTo(TARGET_USER);
        assertThat(loaded.getSessionId()).isEqualTo(session);
        assertThat(loaded.getAuthGeneration()).isEqualTo(9);
        assertThat(loaded.getRefreshJti()).isEqualTo(materials.refreshJti());
        assertThat(loaded.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(loaded.getSwitchSourceUserId()).isEqualTo(SOURCE_USER);
        assertThat(loaded.getSwitchVerifiedAt()).isEqualTo(VERIFIED_AT);
    }

    @Test
    @DisplayName("INVALIDATED switch 는 phase/confirmed 만 남고 여섯 증거는 null")
    void invalidatedSwitchKeepsOnlyTerminalMarker() {
        LoginAttempt attempt = verified();
        attempt.invalidate();
        UUID id = persist(attempt);

        LoginAttempt loaded = reload(id);
        assertThat(loaded.getStatus()).isEqualTo(LoginAttemptStatus.INVALIDATED);
        assertThat(loaded.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(loaded.isAccountSwitchConfirmed()).isTrue();
        assertThat(loaded.getSwitchSourceUserId()).isNull();
        assertThat(loaded.getSwitchSourceSessionId()).isNull();
        assertThat(loaded.getSwitchSourceAuthGeneration()).isNull();
        assertThat(loaded.getSwitchTargetUserId()).isNull();
        assertThat(loaded.getSwitchTargetSocialAccountId()).isNull();
        assertThat(loaded.getSwitchVerifiedAt()).isNull();
    }

    @Test
    @DisplayName("CHECK 가 거절하는 모양들 — unconfirmed+phase, 부분 증거, 음수 세대, REPREPARE+phase, phase null+증거")
    void checkRejectsIllegalShapes() {
        // confirmed=false + phase — phase 가 있으면 confirmed 여야 한다.
        assertThatThrownBy(() -> insertSwitchRow("PENDING", false, "VERIFIED",
                SOURCE_USER, SOURCE_SESSION, 7L, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(DataIntegrityViolationException.class);
        // phase + 증거 일부 null — VERIFIED 는 여섯 증거가 전부 있어야 한다.
        assertThatThrownBy(() -> insertSwitchRow("PENDING", true, "VERIFIED",
                SOURCE_USER, null, 7L, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 음수 generation.
        assertThatThrownBy(() -> insertSwitchRow("PENDING", true, "VERIFIED",
                SOURCE_USER, SOURCE_SESSION, -1L, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 종료·재준비 상태에 phase — REPREPARE_REQUIRED 는 어느 절에도 없다.
        assertThatThrownBy(() -> insertSwitchRow("REPREPARE_REQUIRED", true, "VERIFIED",
                SOURCE_USER, SOURCE_SESSION, 7L, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(DataIntegrityViolationException.class);
        // phase=null + 증거 — UNKNOWN 을 통과시키는 SQL CHECK 의 함정. confirmed 와 무관하게 거절돼야 한다.
        assertThatThrownBy(() -> insertSwitchRow("PENDING", true, null,
                SOURCE_USER, SOURCE_SESSION, 7L, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertSwitchRow("PENDING", false, null,
                SOURCE_USER, SOURCE_SESSION, 7L, TARGET_USER, TARGET_SOCIAL, VERIFIED_AT))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private void insertSwitchRow(String status, boolean confirmed, String phase,
            UUID sourceUser, UUID sourceSession, Long sourceGeneration,
            UUID targetUser, UUID targetSocial, Instant verifiedAt) {
        jdbcTemplate().update(
                "INSERT INTO login_attempts (attempt_id, status, digest_key_id, credential_digest,"
                        + " provider, credential_kind, terms_version, claimed_at, recovery_expires_at,"
                        + " account_switch_confirmed, switch_phase, switch_source_user_id,"
                        + " switch_source_session_id, switch_source_auth_generation,"
                        + " switch_target_user_id, switch_target_social_account_id, switch_verified_at)"
                        + " VALUES (?, ?, 'key-id', 'digest', 'APPLE', 'id_token', '2026-09',"
                        + " now(), now() + interval '5 minutes', ?, ?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), status, confirmed, phase,
                sourceUser, sourceSession, sourceGeneration, targetUser, targetSocial,
                verifiedAt == null ? null : Timestamp.from(verifiedAt));
    }

    private JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}

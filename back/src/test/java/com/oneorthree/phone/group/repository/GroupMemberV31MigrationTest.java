package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V31 백필 마이그레이션의 실 SQL 검증 — 유령 방장 그룹의 최고참 승계(GROMO-1243).
 *
 * <p>V30 은 유령(탈퇴자) 멤버십을 이탈 처리하되 유령 방장의 소유권은 범위 밖으로 남겼다(V30 :16).
 * 그 결과가 "활성 OWNER 없는 살아있는 그룹" — V31 은 오너 정책 결정에 따라 그룹별 최고참 활성
 * 멤버({@code ORDER BY created_at ASC, id ASC})를 방장으로 승계한다. 보는 것 네 가지:
 * ① 활성 OWNER 부재 그룹은 최고참 활성 멤버만 OWNER 로 승계되고 나머지·유령 방장 이력 행은 불변,
 * ② 활성 OWNER 가 있는 그룹은 무변경, ③ ENDED·삭제된 그룹은 승계 대상이 아니다,
 * ④ 멱등 — 승계 후 같은 UPDATE 재실행 시 0행. 검증 방식은 {@link GroupMemberV30MigrationTest}
 * 선례를 따라 전용 컨테이너에 Flyway 체인을 실제로 돌린다 — V30 까지 올린 스키마에 V30 직후의
 * 유령 방장 상태를 재현한 뒤 V31 을 적용한다.
 */
class GroupMemberV31MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID OWNERLESS_GROUP_ID = UUID.randomUUID();
    private static final UUID HEALTHY_GROUP_ID = UUID.randomUUID();
    private static final UUID ENDED_GHOST_GROUP_ID = UUID.randomUUID();
    private static final UUID ENDED_ACTIVE_GROUP_ID = UUID.randomUUID();
    private static final UUID DELETED_GROUP_ID = UUID.randomUUID();

    private static final UUID GHOST_OWNER_ID = UUID.randomUUID();
    private static final UUID SENIOR_MEMBER_ID = UUID.randomUUID();
    private static final UUID JUNIOR_MEMBER_ID = UUID.randomUUID();
    private static final UUID HEALTHY_OWNER_ID = UUID.randomUUID();
    private static final UUID HEALTHY_MEMBER_ID = UUID.randomUUID();
    private static final UUID ENDED_MEMBER_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("활성 OWNER 부재 그룹은 최고참 활성 멤버가 OWNER 로 승계되고, 나머지 멤버·유령 방장 이력 행은 불변")
    void promotesOldestActiveMemberInOwnerlessGroup() {
        givenV30StateWithOwnerlessGroups();

        migrate(MigrationVersion.fromVersion("31"));

        // 최고참(가입 시각이 더 이른) 활성 멤버만 승계 — updated_at 도 갱신된다.
        assertThat(membershipOf(SENIOR_MEMBER_ID, OWNERLESS_GROUP_ID))
                .containsEntry("role", "OWNER").containsEntry("is_left", false);
        // 후참 멤버는 MEMBER 그대로 — 승계는 그룹당 정확히 1명이다.
        assertThat(membershipOf(JUNIOR_MEMBER_ID, OWNERLESS_GROUP_ID))
                .containsEntry("role", "MEMBER").containsEntry("is_left", false);
        // 유령 방장 행은 이력으로 보존(강등 없음) — is_left=true 라 판정에 잡히지 않는다.
        assertThat(membershipOf(GHOST_OWNER_ID, OWNERLESS_GROUP_ID))
                .containsEntry("role", "OWNER").containsEntry("is_left", true);
        // 승계는 데이터 전용 — 그룹 상태는 건드리지 않는다.
        assertThat(statusOf(OWNERLESS_GROUP_ID)).isEqualTo("ACTIVE");
    }

    @Test
    @DisplayName("활성 OWNER 가 있는 그룹은 V31 이 아무것도 바꾸지 않는다")
    void leavesGroupsWithActiveOwnerUntouched() {
        givenV30StateWithOwnerlessGroups();

        migrate(MigrationVersion.fromVersion("31"));

        assertThat(membershipOf(HEALTHY_OWNER_ID, HEALTHY_GROUP_ID))
                .containsEntry("role", "OWNER").containsEntry("is_left", false);
        assertThat(membershipOf(HEALTHY_MEMBER_ID, HEALTHY_GROUP_ID))
                .containsEntry("role", "MEMBER").containsEntry("is_left", false);
    }

    @Test
    @DisplayName("ENDED 그룹은 유령뿐이든 활성 멤버가 남았든 승계하지 않는다")
    void skipsEndedGroups() {
        givenV30StateWithOwnerlessGroups();

        migrate(MigrationVersion.fromVersion("31"));

        // 유령뿐인 ENDED 그룹(V30 이 닫은 형태) — 승계 대상 자체가 없다.
        assertThat(membershipOf(GHOST_OWNER_ID, ENDED_GHOST_GROUP_ID))
                .containsEntry("role", "OWNER").containsEntry("is_left", true);
        assertThat(statusOf(ENDED_GHOST_GROUP_ID)).isEqualTo("ENDED");
        // 활성 멤버가 남아 있어도 ENDED 면 승계하지 않는다 — status <> 'ENDED' 술어 검증.
        assertThat(membershipOf(ENDED_MEMBER_ID, ENDED_ACTIVE_GROUP_ID))
                .containsEntry("role", "MEMBER").containsEntry("is_left", false);
        // 소프트 삭제된 그룹도 승계하지 않는다 — deleted_at IS NULL 술어 검증.
        assertThat(membershipOf(ENDED_MEMBER_ID, DELETED_GROUP_ID))
                .containsEntry("role", "MEMBER").containsEntry("is_left", false);
    }

    @Test
    @DisplayName("멱등 — V31 적용 후 같은 UPDATE 를 재실행하면 0행 (활성 OWNER 술어 자기해제)")
    void rerunningBackfillUpdatesNothing() {
        givenV30StateWithOwnerlessGroups();
        migrate(MigrationVersion.fromVersion("31"));

        int rerunAffected = jdbcTemplate().update(v31Sql());

        assertThat(rerunAffected).isZero();
    }

    @Test
    @DisplayName("가입 시각 동률이면 id 오름차순으로 결정 — 승계자는 항상 결정적이다")
    void breaksCreatedAtTiesById() {
        migrate(MigrationVersion.fromVersion("30"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        UUID groupId = UUID.randomUUID();
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID smallerMembershipId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID biggerMembershipId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        insertUser(jdbcTemplate, firstUserId, "동률일번", false);
        insertUser(jdbcTemplate, secondUserId, "동률이번", false);
        insertGroup(jdbcTemplate, groupId, "동률방", "ACTIVE", false);
        // created_at 이 완전히 같은 두 활성 멤버 — id 가 작은 쪽이 승계해야 한다.
        // now() 는 문장마다 달라 동률이 안 되므로 고정 리터럴 시각으로 심는다.
        insertMembershipAt(jdbcTemplate, biggerMembershipId, secondUserId, groupId);
        insertMembershipAt(jdbcTemplate, smallerMembershipId, firstUserId, groupId);

        migrate(MigrationVersion.fromVersion("31"));

        assertThat(membershipOf(firstUserId, groupId)).containsEntry("role", "OWNER");
        assertThat(membershipOf(secondUserId, groupId)).containsEntry("role", "MEMBER");
    }

    /**
     * V30 까지 올린 스키마에 V30 직후의 소유권 공백 상태를 재현한다.
     *
     * <ul>
     *   <li>공백 그룹(ACTIVE): 유령 방장(role='OWNER', is_left=true — V30 이 이탈 처리한 형태)
     *       + 활성 멤버 2명(가입 시각 10일 전·5일 전) — 최고참 승계 대상</li>
     *   <li>정상 그룹(ACTIVE): 활성 OWNER + 활성 MEMBER — 무변경 대상</li>
     *   <li>유령뿐 ENDED 그룹: V30 1)이 닫은 형태 — 승계 없음</li>
     *   <li>활성 멤버 잔존 ENDED 그룹(OWNER 없음): status 술어 검증용 — 승계 없음</li>
     *   <li>소프트 삭제 그룹(OWNER 없음, 활성 멤버 있음): deleted_at 술어 검증용 — 승계 없음</li>
     * </ul>
     */
    private void givenV30StateWithOwnerlessGroups() {
        migrate(MigrationVersion.fromVersion("30"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();

        insertUser(jdbcTemplate, GHOST_OWNER_ID, null, true);       // 탈퇴 — PII 파기로 nickname null
        insertUser(jdbcTemplate, SENIOR_MEMBER_ID, "최고참", false);
        insertUser(jdbcTemplate, JUNIOR_MEMBER_ID, "후참", false);
        insertUser(jdbcTemplate, HEALTHY_OWNER_ID, "정상방장", false);
        insertUser(jdbcTemplate, HEALTHY_MEMBER_ID, "정상멤버", false);
        insertUser(jdbcTemplate, ENDED_MEMBER_ID, "종료방멤버", false);

        insertGroup(jdbcTemplate, OWNERLESS_GROUP_ID, "방장공백방", "ACTIVE", false);
        insertGroup(jdbcTemplate, HEALTHY_GROUP_ID, "정상방", "ACTIVE", false);
        insertGroup(jdbcTemplate, ENDED_GHOST_GROUP_ID, "유령만종료방", "ENDED", false);
        insertGroup(jdbcTemplate, ENDED_ACTIVE_GROUP_ID, "활성잔존종료방", "ENDED", false);
        insertGroup(jdbcTemplate, DELETED_GROUP_ID, "삭제된방", "ACTIVE", true);

        // 공백 그룹 — 유령 방장은 V30 이 이탈 처리한 형태(is_left=true, LEFT)로 심는다.
        insertMembership(jdbcTemplate, UUID.randomUUID(), GHOST_OWNER_ID, OWNERLESS_GROUP_ID,
                "OWNER", true, "LEFT", 30);
        insertMembership(jdbcTemplate, UUID.randomUUID(), SENIOR_MEMBER_ID, OWNERLESS_GROUP_ID,
                "MEMBER", false, null, 10);
        insertMembership(jdbcTemplate, UUID.randomUUID(), JUNIOR_MEMBER_ID, OWNERLESS_GROUP_ID,
                "MEMBER", false, null, 5);

        insertMembership(jdbcTemplate, UUID.randomUUID(), HEALTHY_OWNER_ID, HEALTHY_GROUP_ID,
                "OWNER", false, null, 10);
        insertMembership(jdbcTemplate, UUID.randomUUID(), HEALTHY_MEMBER_ID, HEALTHY_GROUP_ID,
                "MEMBER", false, null, 5);

        insertMembership(jdbcTemplate, UUID.randomUUID(), GHOST_OWNER_ID, ENDED_GHOST_GROUP_ID,
                "OWNER", true, "LEFT", 30);

        insertMembership(jdbcTemplate, UUID.randomUUID(), ENDED_MEMBER_ID, ENDED_ACTIVE_GROUP_ID,
                "MEMBER", false, null, 10);

        insertMembership(jdbcTemplate, UUID.randomUUID(), ENDED_MEMBER_ID, DELETED_GROUP_ID,
                "MEMBER", false, null, 10);
    }

    private Map<String, Object> membershipOf(UUID userId, UUID groupId) {
        return jdbcTemplate().queryForMap(
                "SELECT role, is_left, left_reason FROM group_members WHERE user_id = ? AND group_id = ?",
                userId, groupId);
    }

    private String statusOf(UUID groupId) {
        return jdbcTemplate().queryForObject(
                "SELECT status FROM groups WHERE id = ?", String.class, groupId);
    }

    private void insertUser(JdbcTemplate jdbcTemplate, UUID id, String nickname, boolean deleted) {
        jdbcTemplate.update(
                "INSERT INTO users (id, created_at, is_guest, nickname, is_deleted)"
                        + " VALUES (?, now(), false, ?, ?)",
                id, nickname, deleted);
    }

    private void insertGroup(JdbcTemplate jdbcTemplate, UUID id, String name, String status, boolean deleted) {
        jdbcTemplate.update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status, deleted_at)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, ?, ?, CASE WHEN ? THEN now() END)",
                id, name, status, deleted);
    }

    /** created_at 은 {@code daysAgo}일 전으로 심는다 — 최고참 판정(가입 시각 오름차순)을 검증하기 위함. */
    private void insertMembership(JdbcTemplate jdbcTemplate, UUID id, UUID userId, UUID groupId,
            String role, boolean isLeft, String leftReason, int daysAgo) {
        jdbcTemplate.update(
                "INSERT INTO group_members (id, user_id, group_id, role, notification_enabled,"
                        + " is_left, left_reason, created_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, true, ?, ?, now() - (? * interval '1 day'), now())",
                id, userId, groupId, role, isLeft, leftReason, daysAgo);
    }

    /** created_at 동률 재현용 — 고정 리터럴 시각으로 심어 id 타이브레이크만 남긴다. */
    private void insertMembershipAt(JdbcTemplate jdbcTemplate, UUID id, UUID userId, UUID groupId) {
        jdbcTemplate.update(
                "INSERT INTO group_members (id, user_id, group_id, role, notification_enabled,"
                        + " is_left, left_reason, created_at, updated_at)"
                        + " VALUES (?, ?, ?, 'MEMBER', true, false, null,"
                        + " timestamptz '2026-01-01 00:00:00+00', now())",
                id, userId, groupId);
    }

    /** V31 SQL 원문 — 멱등 재실행 검증에서 마이그레이션 파일과 동일한 문장을 그대로 쓴다. */
    private String v31Sql() {
        try {
            return new String(
                    new ClassPathResource("db/migration/V31__backfill_ownerless_group_owner.sql")
                            .getInputStream().readAllBytes(),
                    StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}

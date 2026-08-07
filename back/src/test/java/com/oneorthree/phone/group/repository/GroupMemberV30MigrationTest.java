package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V30 백필 마이그레이션의 실 SQL 검증 — 탈퇴 유저 유령 멤버십 정리(GROMO-1220, 결정 D2).
 *
 * <p>보는 것 네 가지: ① #497 이전 탈퇴자의 유령 활성 멤버십({@code is_deleted=true} +
 * {@code is_left=false})이 자진 탈퇴 시맨틱({@code is_left=true, left_reason='LEFT'} —
 * {@code GroupMember.leave()} 와 동일)으로 이탈 처리된다, ② 활성 비탈퇴 멤버·기존 이탈 행
 * (KICKED 사유 포함)은 값 변경 없이 보존된다, ③ 활성 멤버가 전부 탈퇴 유저뿐인 그룹은
 * ENDED 로 종료된다(withdraw A-2 솔로 방장 시맨틱), ④ 활성 비탈퇴 멤버가 남는 그룹의 상태는
 * 건드리지 않는다. 검증 방식은 {@link GroupBetV29MigrationTest} 선례를 따라 전용 컨테이너에
 * Flyway 체인을 실제로 돌린다 — V29 까지 올린 스키마에 유령 상태를 재현한 뒤 V30 을 적용한다.
 */
class GroupMemberV30MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GHOST_ONLY_GROUP_ID = UUID.randomUUID();
    private static final UUID MIXED_GROUP_ID = UUID.randomUUID();
    private static final UUID GHOST_OWNER_ID = UUID.randomUUID();
    private static final UUID GHOST_MEMBER_ID = UUID.randomUUID();
    private static final UUID ACTIVE_USER_ID = UUID.randomUUID();
    private static final UUID KICKED_DELETED_USER_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("유령 활성 멤버십(is_deleted + is_left=false)은 LEFT 로 이탈 처리되고, 활성·기존 이탈 행은 보존된다")
    void backfillsGhostMembershipsAsLeft() {
        givenV29StateWithGhosts();

        migrate(MigrationVersion.LATEST);

        // 유령 두 행 — 자진 탈퇴 시맨틱(GroupMember.leave)과 같은 값으로 백필된다.
        assertThat(membershipOf(GHOST_OWNER_ID, GHOST_ONLY_GROUP_ID))
                .containsEntry("is_left", true).containsEntry("left_reason", "LEFT");
        assertThat(membershipOf(GHOST_MEMBER_ID, MIXED_GROUP_ID))
                .containsEntry("is_left", true).containsEntry("left_reason", "LEFT");
        // 활성 비탈퇴 멤버는 무변경 — 백필이 산 사람을 건드리면 안 된다.
        assertThat(membershipOf(ACTIVE_USER_ID, MIXED_GROUP_ID))
                .containsEntry("is_left", false).containsEntry("left_reason", null);
        // 이미 이탈한 행은 사유 불문 보존 — KICKED 를 LEFT 로 덮으면 재참여 차단 이력이 사라진다.
        assertThat(membershipOf(KICKED_DELETED_USER_ID, MIXED_GROUP_ID))
                .containsEntry("is_left", true).containsEntry("left_reason", "KICKED");
    }

    @Test
    @DisplayName("활성 멤버가 전부 탈퇴 유저뿐인 그룹만 ENDED — 활성 멤버가 남는 그룹의 상태는 불변")
    void closesGroupsWhoseOnlyActiveMembersAreDeleted() {
        givenV29StateWithGhosts();

        migrate(MigrationVersion.LATEST);

        // withdraw A-2(솔로 방장 → 그룹 ENDED) 시맨틱 재현 — 유령뿐인 그룹은 닫힌다.
        assertThat(statusOf(GHOST_ONLY_GROUP_ID)).isEqualTo("ENDED");
        // 활성 비탈퇴 멤버가 남는 그룹은 유령 멤버십만 정리하고 상태는 건드리지 않는다.
        assertThat(statusOf(MIXED_GROUP_ID)).isEqualTo("ACTIVE");
    }

    /**
     * V29 까지 올린 스키마에 #497 이전 탈퇴의 유령 상태를 재현한다.
     *
     * <ul>
     *   <li>유령 전용 그룹: 탈퇴 유저가 OWNER 로 혼자 활성(is_left=false) — 그룹 종료 대상</li>
     *   <li>혼합 그룹: 탈퇴 유저 MEMBER 활성(유령) + 비탈퇴 활성 멤버 + 탈퇴·강퇴 이력 행 — 그룹 유지</li>
     * </ul>
     */
    private void givenV29StateWithGhosts() {
        migrate(MigrationVersion.fromVersion("29"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();

        insertUser(jdbcTemplate, GHOST_OWNER_ID, null, true);      // 탈퇴 — PII 파기로 nickname null
        insertUser(jdbcTemplate, GHOST_MEMBER_ID, null, true);
        insertUser(jdbcTemplate, KICKED_DELETED_USER_ID, null, true);
        insertUser(jdbcTemplate, ACTIVE_USER_ID, "재영", false);

        insertGroup(jdbcTemplate, GHOST_ONLY_GROUP_ID, "유령만남은방");
        insertGroup(jdbcTemplate, MIXED_GROUP_ID, "활성혼합방");

        insertMembership(jdbcTemplate, GHOST_OWNER_ID, GHOST_ONLY_GROUP_ID, "OWNER", false, null);
        insertMembership(jdbcTemplate, GHOST_MEMBER_ID, MIXED_GROUP_ID, "MEMBER", false, null);
        insertMembership(jdbcTemplate, ACTIVE_USER_ID, MIXED_GROUP_ID, "OWNER", false, null);
        insertMembership(jdbcTemplate, KICKED_DELETED_USER_ID, MIXED_GROUP_ID, "MEMBER", true, "KICKED");
    }

    private Map<String, Object> membershipOf(UUID userId, UUID groupId) {
        return jdbcTemplate().queryForMap(
                "SELECT is_left, left_reason FROM group_members WHERE user_id = ? AND group_id = ?",
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

    private void insertGroup(JdbcTemplate jdbcTemplate, UUID id, String name) {
        jdbcTemplate.update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, ?, 'ACTIVE')",
                id, name);
    }

    private void insertMembership(JdbcTemplate jdbcTemplate, UUID userId, UUID groupId,
            String role, boolean isLeft, String leftReason) {
        jdbcTemplate.update(
                "INSERT INTO group_members (id, user_id, group_id, role, notification_enabled,"
                        + " is_left, left_reason, created_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, true, ?, ?, now(), now())",
                UUID.randomUUID(), userId, groupId, role, isLeft, leftReason);
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

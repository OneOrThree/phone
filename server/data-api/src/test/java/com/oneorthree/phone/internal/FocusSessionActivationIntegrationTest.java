package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 집중 세션 시작 게이트를 연 뒤의 경로 (GROMO-1924) — <b>실제 Flyway PostgreSQL</b> 위에서 본다.
 *
 * <p>게이트는 {@code focus.session.start-enabled} 로 연다. 잠금·부분 UNIQUE·CHECK·V67 이 전부 DB 에
 * 있는 규칙이라 mock 으로는 의미가 없다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FocusSessionActivationIntegrationTest {

    static final String TOKEN = "test-focus-activation-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("focus.session.start-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        List<String> allow = List.of(
                "POST /internal/users/*/focus-sessions",
                "GET /internal/users/*/focus-sessions/current",
                "POST /internal/users/*/focus-sessions/*/pause",
                "POST /internal/users/*/focus-sessions/*/resume",
                "POST /internal/users/*/focus-sessions/*/finish",
                "GET /internal/users/*/focus-summary");
        for (int i = 0; i < allow.size(); i++) {
            String rule = allow.get(i);
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> rule);
        }
    }

    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    GroupMemberService groupMembers;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserQueryService users;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    // ---------------------------------------------------------------- #7 소속 상실의 출구

    @Test
    @DisplayName("강퇴는 대상의 휴식 중 세션을 같은 TX 에서 MEMBERSHIP_LOST 로 끝내고 정산하지 않는다(FR-D03)")
    void kickEndsTheProgressingSessionWithoutSettlement() {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("강퇴섬", null, false),
                UUID.randomUUID()).id();
        UUID member = newUser();
        joinAndMoveTo(member, island);
        FocusSessionView started = start(member, island);
        FocusSessionView paused = focus.pause(member, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        groupMembers.kickMember(island, member, host);

        Map<String, Object> detail = detailRow(started.id());
        assertThat(detail.get("lifecycle")).isEqualTo("MEMBERSHIP_LOST");
        assertThat(detail.get("rest_seat")).as("휴식 자리를 반납한다").isNull();
        assertThat(((Number) detail.get("version")).longValue()).isEqualTo(paused.version() + 1);
        assertThat(count("select count(*) from focus_session_intervals where session_id=? and ended_at is null",
                started.id())).as("열린 구간이 남지 않는다").isZero();
        assertThat(jdbc.queryForObject("select status from focus_sessions where id=?", String.class,
                started.id())).as("기본 마커는 통계 제외로 닫힌다 — 미정산").isEqualTo("AUTO_CLOSED");
        assertThat(count("select count(*) from focus_settlements where session_id=?", started.id())).isZero();
        assertThat(count("select count(*) from event_outbox where type='focus.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='completed'", started.id().toString()))
                .as("섬 목록에서 지우는 사건을 남긴다").isEqualTo(1);
    }

    @Test
    @DisplayName("강퇴된 사용자는 옛 세션을 전이할 수 없지만, 다른 섬에서 새 세션을 열 수 있다 — 출구가 있다")
    void kickedUserCanStartAgainElsewhere() {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("떠난섬", null, false),
                UUID.randomUUID()).id();
        UUID member = newUser();
        joinAndMoveTo(member, island);
        FocusSessionView started = start(member, island);

        groupMembers.kickMember(island, member, host);

        assertThatThrownBy(() -> focus.pause(member, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
        UUID home = islands.create(member, new CreateIslandCommandRequest("새섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView again = start(member, home);
        assertThat(again.status()).isEqualTo(FocusSessionView.STATUS_ACTIVE);
    }

    @Test
    @DisplayName("자진 탈퇴는 진행 중 세션이 있으면 409 다 — 휴식도 같다(「먼저 끝내고 나가라」)")
    void voluntaryLeaveIsRefusedWhileASessionIsProgressing() {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("못떠나섬", null, false),
                UUID.randomUUID()).id();
        UUID member = newUser();
        joinAndMoveTo(member, island);
        FocusSessionView started = start(member, island);
        focus.pause(member, started.id(), new FocusVersionedCommandRequest(started.version()),
                UUID.randomUUID());

        assertThatThrownBy(() -> groupMembers.withdrawGroup(island, member))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThat(count("select count(*) from group_members where group_id=? and user_id=? and is_left=false",
                island, member)).as("거절은 멤버십을 바꾸지 않는다").isEqualTo(1);
    }

    // ---------------------------------------------------------------- #9 rest 투영

    @Test
    @DisplayName("start 는 focus 사건과 함께 rest 투영 제거(active·자리 null) 사건을 같은 TX 에 남긴다")
    void startAlsoDurablyClearsTheRestProjection() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("모닥불섬", null, false),
                UUID.randomUUID()).id();

        FocusSessionView started = start(user, island);

        assertThat(count("select count(*) from event_outbox where type='rest.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='active' "
                + "and params->'restSeat'='null'::jsonb and params->'restStartedAt'='null'::jsonb",
                started.id().toString())).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 도구

    FocusSessionView start(UUID userId, UUID islandId) {
        return focus.start(userId, new FocusSessionStartCommandRequest(islandId, "알고리즘", 25), UUID.randomUUID());
    }

    UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    /** 이미 있는 섬에 주민으로 넣고 현재 섬을 옮긴다 — 가입 승인 흐름은 이 테스트의 관심이 아니다. */
    void joinAndMoveTo(UUID userId, UUID islandId) {
        User user = users.getCaller(userId);
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island).role(GroupMemberRole.MEMBER).build());
        islands.switchCurrentIsland(userId, islandId, UUID.randomUUID());
    }

    Map<String, Object> detailRow(UUID sessionId) {
        return jdbc.queryForMap("select * from focus_session_details where session_id=?", sessionId);
    }

    long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}

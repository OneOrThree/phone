package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.InvitationResolveCommandRequest;
import com.oneorthree.phone.internal.dto.InvitationResolvedView;
import com.oneorthree.phone.internal.dto.IslandSummaryView;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandResultView;
import com.oneorthree.phone.internal.service.IslandInvitationService;
import com.oneorthree.phone.internal.service.IslandJoinService;
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

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 초대 링크 도착 (GROMO-2264, 섬 외부 계약 §4)을 <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점으로 검증한다.
 * 시드는 생산 서비스와 엔티티로만 만든다. 도착은 {@code arrive=true} opt-in 이다 — 없으면 종전 미리보기다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandInvitationArrivalIntegrationTest {

    private static final String TOKEN = "test-island-invitation-arrival-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"POST /internal/users/*/invitations/resolve",
            "POST /internal/users/*/islands/*/memberships", "PUT /internal/users/*/current-island"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @Autowired
    IslandInvitationService invitations;
    @Autowired
    IslandJoinService joins;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    FocusService legacyFocus;
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

    @Test
    @DisplayName("arrive 가 없으면 종전 미리보기다 — 도착·가입·신청·이동이 없고 arrival 은 null, 모르는 필드는 무시한다")
    void resolveWithoutArriveIsTheOldPreview() throws Exception {
        UUID host = newUser();
        UUID open = island("미리보기섬", false, false);
        UUID approval = island("미리보기승인섬", false, true);
        joinAs(host, open, GroupMemberRole.OWNER);
        joinAs(host, approval, GroupMemberRole.OWNER);
        String openCode = invitations.issue(host, open, UUID.randomUUID()).code();
        String approvalCode = invitations.issue(host, approval, UUID.randomUUID()).code();
        UUID user = newUser();

        for (String body : List.of("{\"code\":\"" + openCode + "\"}",
                "{\"code\":\"" + openCode + "\",\"arrive\":false}",
                // 구 Data 서버가 새 Business 의 arrive 를 받는 상황의 근거 — 모르는 필드는 무시된다(Boot 기본).
                "{\"code\":\"" + openCode + "\",\"unknownProbe\":true}")) {
            mvc.perform(post("/internal/users/" + user + "/invitations/resolve")
                            .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                            .contentType("application/json").content(body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.invitationToken").value(openCode))
                    .andExpect(jsonPath("$.island.id").value(open.toString()))
                    .andExpect(jsonPath("$.island.membershipStatus").value("none"))
                    .andExpect(jsonPath("$.island.memberCount").value(1))
                    .andExpect(jsonPath("$.island.arrivedBefore").value(false))
                    .andExpect(jsonPath("$.arrival").value(nullValue()));
        }
        assertThat(resolve(user, approvalCode, null).arrival()).isNull();

        assertThat(count("select count(*) from island_arrivals where user_id=?", user)).isZero();
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user)).isZero();
        assertThat(currentIsland(user)).isNull();
        assertThat(memberEvents(open)).isZero();
    }

    @Test
    @DisplayName("누구나 가입 섬 — arrive=true 면 해석이 가입·이동·도착까지 한다")
    void openIslandInviteJoinsMovesAndArrives() throws Exception {
        UUID host = newUser();
        UUID islandId = island("초대섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();

        mvc.perform(post("/internal/users/" + user + "/invitations/resolve")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .contentType("application/json").content("{\"code\":\"" + code + "\",\"arrive\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invitationToken").value(code))
                .andExpect(jsonPath("$.arrival.islandId").value(islandId.toString()))
                .andExpect(jsonPath("$.arrival.arrived").value(true))
                .andExpect(jsonPath("$.arrival.membershipStatus").value("active"))
                .andExpect(jsonPath("$.arrival.reason").value(nullValue()))
                .andExpect(jsonPath("$.island.membershipStatus").value("active"))
                .andExpect(jsonPath("$.island.memberCount").value(2))
                .andExpect(jsonPath("$.island.arrivedBefore").value(true));
        assertThat(currentIsland(user)).isEqualTo(islandId);
        assertThat(activeMemberships(user, islandId)).isEqualTo(1);
        assertThat(count("select count(*) from island_arrivals where user_id=?", user))
                .as("도착은 초대한 그 섬 1곳에만 남는다").isEqualTo(1);
        assertThat(arrived(user, islandId)).isTrue();
        assertThat(memberEvents(islandId)).isEqualTo(1);
    }

    @Test
    @DisplayName("승인제 섬 — 해석은 도착만 남기고 신청하지 않는다. 방문자가 신청해 승인되면 바로 이동 대상이고 편지도 «이미 도착»이다")
    void approvalIslandInviteOnlyArrivesAndTheVisitorApplies() throws Exception {
        UUID host = newUser();
        UUID islandId = island("승인초대섬", false, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("내섬", null, false, null),
                UUID.randomUUID()).id();

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("none");
        assertThat(resolved.arrival().reason()).isNull();
        assertThat(resolved.island().membershipStatus()).isEqualTo("none");
        assertThat(resolved.island().arrivedBefore()).isTrue();
        assertThat(arrived(user, islandId)).isTrue();
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user))
                .as("링크를 연 것만으로 섬장의 신청 목록이 차지 않는다").isZero();
        assertThat(currentIsland(user)).as("방문자는 옮기지 않는다").isEqualTo(home);

        // 방문자가 [가입 신청] 을 직접 누른다 — 초대 토큰을 실은 가입이 신청 1건과 초대 근거를 남기고,
        // 다시 눌러도 같은 신청이다.
        JoinIslandResultView applied = joins.join(user, islandId, new JoinIslandCommandRequest(code),
                UUID.randomUUID());
        assertThat(applied.status()).isEqualTo("pending");
        assertThat(joins.join(user, islandId, new JoinIslandCommandRequest(code), UUID.randomUUID()).requestId())
                .isEqualTo(applied.requestId());
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user)).isEqualTo(1);
        assertThat(count("select count(*) from island_join_requests where id=? and status='PENDING'"
                + " and invite_link_id is not null", applied.requestId())).isEqualTo(1);

        // 열린 신청이 있으면 다시 해석해도 그 신청을 그대로 보여 주고 사건을 만들지 않는다.
        long requestEvents = count("select count(*) from event_outbox where type='join.request.updated'");
        InvitationResolvedView again = resolve(user, code);
        assertThat(again.arrival().membershipStatus()).isEqualTo("pending");
        assertThat(again.island().joinRequestId()).isEqualTo(applied.requestId());
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"))
                .isEqualTo(requestEvents);

        joins.answer(host, islandId, applied.requestId(), true, UUID.randomUUID());

        IslandSummaryView approved = islands.myIslands(user).items().stream()
                .filter(item -> item.id().equals(islandId)).findFirst().orElseThrow();
        assertThat(approved.arrivedBefore()).as("초대로 이미 도착했다 — 처음 한 번의 항해가 없다").isTrue();
        mvc.perform(put("/internal/users/" + user + "/current-island")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content("{\"islandId\":\"" + islandId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentIslandId").value(islandId.toString()));
        assertThat(approvalLetter(user))
                .isEqualTo("승인초대섬섬 가입이 승인됐어요. 이미 도착한 섬이라 뗏목에서 바로 갈 수 있어요");
    }

    @Test
    @DisplayName("도착 없이(망원경) 승인된 섬의 승인 편지는 종전대로 항해 시간을 알린다")
    void telescopeApprovalLetterKeepsTheSailingTime() {
        UUID host = newUser();
        UUID islandId = island("망원승인섬", false, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID user = newUser();
        UUID requestId = joins.join(user, islandId, new JoinIslandCommandRequest(null, "telescope"),
                UUID.randomUUID()).requestId();

        joins.answer(host, islandId, requestId, true, UUID.randomUUID());

        assertThat(arrived(user, islandId)).isFalse();
        assertThat(approvalLetter(user)).matches(
                "망원승인섬섬 가입이 승인됐어요\\. 망원경에서 출발해 보세요 — 지금 출발하면 (30|60|90)분 뒤 도착해요");
    }

    @Test
    @DisplayName("소속 섬이 3개면 도착만 남기고 가입·신청은 하지 않는다 — reason=ISLAND_LIMIT")
    void fullUserArrivesWithoutJoining() {
        UUID host = newUser();
        UUID open = island("열린섬", false, false);
        UUID approval = island("닫힌섬", false, true);
        joinAs(host, open, GroupMemberRole.OWNER);
        joinAs(host, approval, GroupMemberRole.OWNER);
        String openCode = invitations.issue(host, open, UUID.randomUUID()).code();
        String approvalCode = invitations.issue(host, approval, UUID.randomUUID()).code();
        UUID user = newUser();
        for (int i = 0; i < 3; i++) {
            joinAs(user, island("소속섬" + i, false, false), GroupMemberRole.MEMBER);
        }

        for (String code : List.of(openCode, approvalCode)) {
            InvitationResolvedView resolved = resolve(user, code);
            assertThat(resolved.arrival().membershipStatus()).isEqualTo("none");
            assertThat(resolved.arrival().reason()).isEqualTo("ISLAND_LIMIT");
            assertThat(resolved.island().arrivedBefore()).isTrue();
        }
        assertThat(arrived(user, open)).isTrue();
        assertThat(arrived(user, approval)).isTrue();
        assertThat(activeMemberships(user, open)).isZero();
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user)).isZero();
        assertThat(count("select count(*) from group_members where user_id=? and is_left=false", user))
                .isEqualTo(3);
    }

    @Test
    @DisplayName("강퇴된 섬 — 도착만 남기고 reason=KICKED, 다시 들어가지 않는다")
    void kickedUserArrivesWithReason() {
        UUID host = newUser();
        UUID islandId = island("강퇴섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        joinAs(user, islandId, GroupMemberRole.MEMBER);
        jdbc.update("update group_members set is_left=true, left_reason='KICKED'"
                + " where group_id=? and user_id=?", islandId, user);

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("none");
        assertThat(resolved.arrival().reason()).isEqualTo("KICKED");
        assertThat(arrived(user, islandId)).isTrue();
        assertThat(activeMemberships(user, islandId)).isZero();
        assertThat(currentIsland(user)).isNull();
    }

    @Test
    @DisplayName("이미 주민이면 도착만 남긴다 — 옮기지도, 멤버십·사건을 더 만들지도 않는다")
    void residentOnlyArrives() {
        UUID host = newUser();
        UUID islandId = island("주민섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("집섬", null, false, null),
                UUID.randomUUID()).id();
        joinAs(user, islandId, GroupMemberRole.MEMBER);

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("active");
        assertThat(resolved.arrival().reason()).isNull();
        assertThat(arrived(user, islandId)).isTrue();
        assertThat(currentIsland(user)).isEqualTo(home);
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?", islandId, user))
                .isEqualTo(1);
        assertThat(memberEvents(islandId)).isZero();
    }

    @Test
    @DisplayName("같은 초대를 두 번 해석해도 도착 1행(last 갱신)·멤버십 1건이고, 승인제 섬은 신청이 생기지 않는다")
    void resolvingTwiceIsIdempotent() {
        UUID host = newUser();
        UUID open = island("두번섬", false, false);
        UUID approval = island("두번승인섬", false, true);
        joinAs(host, open, GroupMemberRole.OWNER);
        joinAs(host, approval, GroupMemberRole.OWNER);
        String openCode = invitations.issue(host, open, UUID.randomUUID()).code();
        String approvalCode = invitations.issue(host, approval, UUID.randomUUID()).code();
        UUID user = newUser();

        resolve(user, openCode);
        Timestamp firstLast = lastArrivedAt(user, open);
        InvitationResolvedView again = resolve(user, openCode);
        assertThat(again.arrival().membershipStatus()).isEqualTo("active");
        assertThat(count("select count(*) from island_arrivals where user_id=? and island_id=?", user, open))
                .isEqualTo(1);
        assertThat(lastArrivedAt(user, open)).isAfter(firstLast);
        assertThat(count("select count(*) from island_arrivals where user_id=? and island_id=?"
                + " and first_arrived_at < last_arrived_at", user, open)).isEqualTo(1);
        assertThat(activeMemberships(user, open)).isEqualTo(1);
        assertThat(memberEvents(open)).isEqualTo(1);

        for (int i = 0; i < 2; i++) {
            assertThat(resolve(user, approvalCode).arrival().membershipStatus()).isEqualTo("none");
        }
        assertThat(count("select count(*) from island_arrivals where user_id=? and island_id=?", user, approval))
                .isEqualTo(1);
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user)).isZero();
    }

    @Test
    @DisplayName("비공개 섬은 초대가 입구다 — 유효한 코드로 해석하면 가입·도착한다")
    void privateIslandInviteIsTheEntrance() {
        UUID host = newUser();
        UUID islandId = island("비밀섬", true, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.island().visibility()).isEqualTo("private");
        assertThat(resolved.arrival().membershipStatus()).isEqualTo("active");
        assertThat(currentIsland(user)).isEqualTo(islandId);
        assertThat(arrived(user, islandId)).isTrue();
    }

    @Test
    @DisplayName("계약에 사유가 없는 가입 거절(진행 중 집중)은 그대로 전파되고 도착도 남지 않는다")
    void unlistedJoinRejectionPropagatesAndLeavesNoArrival() {
        UUID host = newUser();
        UUID islandId = island("집중중초대섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        islands.create(user, new CreateIslandCommandRequest("집중섬", null, false, null), UUID.randomUUID());
        legacyFocus.startFocusSession(user, new FocusSessionStartRequest(null, null));

        assertThatThrownBy(() -> resolve(user, code))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThat(arrived(user, islandId)).isFalse();
        assertThat(activeMemberships(user, islandId)).isZero();
    }

    // ---------------------------------------------------------------- 도구

    /** 도착 해석(arrive=true) — 이 클래스의 기본 시나리오다. */
    private InvitationResolvedView resolve(UUID userId, String code) {
        return resolve(userId, code, true);
    }

    private InvitationResolvedView resolve(UUID userId, String code, Boolean arrive) {
        return invitations.resolve(userId, new InvitationResolveCommandRequest(code, arrive));
    }

    private String approvalLetter(UUID userId) {
        return jdbc.queryForObject("select content from letters where receiver_id=? and kind='JOIN_APPROVED'",
                String.class, userId);
    }

    private boolean arrived(UUID userId, UUID islandId) {
        return count("select count(*) from island_arrivals where user_id=? and island_id=?", userId, islandId) == 1;
    }

    private Timestamp lastArrivedAt(UUID userId, UUID islandId) {
        return jdbc.queryForObject("select last_arrived_at from island_arrivals where user_id=? and island_id=?",
                Timestamp.class, userId, islandId);
    }

    private long activeMemberships(UUID userId, UUID islandId) {
        return count("select count(*) from group_members where group_id=? and user_id=? and is_left=false",
                islandId, userId);
    }

    private long memberEvents(UUID islandId) {
        return count("select count(*) from event_outbox where subject_id=? and type='island.members.updated'",
                islandId.toString());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private UUID island(String name, boolean isPrivate, boolean approvalRequired) {
        return groups.save(Group.builder().name(name).description(null).maxMembers(10)
                .isPrivate(isPrivate).approvalRequired(approvalRequired)
                .status(GroupStatus.WAITING).build()).getId();
    }

    private void joinAs(UUID userId, UUID islandId, GroupMemberRole role) {
        User user = users.getCaller(userId);
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island).role(role).build());
    }

    private UUID currentIsland(UUID userId) {
        List<UUID> rows = jdbc.queryForList(
                "select current_island_id from user_island_contexts where user_id=?", UUID.class, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}

package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.group.exception.GroupErrorCode;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 초대 링크 도착 (GROMO-2264, 섬 외부 계약 §4)을 <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점으로 검증한다.
 * 시드는 생산 서비스와 엔티티로만 만든다. 도착은 {@code arrive=true} opt-in 이다 — 없으면 종전 미리보기다.
 *
 * <p>사건 수는 전역 합계가 아니라 그 섬({@code subject_id})·그 신청({@code aggregate_id})으로 걸러 전후를 비교한다.
 * 시계는 주입 {@link Clock} 을 실제 시각 근처에 고정하고 필요할 때만 앞으로 민다 — 도착 시각 비교가 벽시계 진행에
 * 기대지 않는다.
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

    @MockitoBean
    Clock clock;
    @Autowired
    IslandInvitationService invitations;
    @Autowired
    IslandJoinService joins;
    @Autowired
    IslandMembershipService islands;
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

    private final AtomicReference<Instant> now = new AtomicReference<>();

    /** 실제 시각 근처(초 단위)에 고정한다 — 토큰 만료·DB now() 와 어긋나지 않게 하면서 도착 시각을 정확히 비교한다. */
    @BeforeEach
    void fixClock() {
        now.set(Instant.now().truncatedTo(ChronoUnit.SECONDS));
        when(clock.instant()).thenAnswer(invocation -> now.get());
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(invocation -> Clock.fixed(now.get(), invocation.getArgument(0)));
    }

    @Test
    @DisplayName("arrive 가 없으면 종전 미리보기다 — 도착·가입·신청·이동·사건이 없고 arrival 은 null, 모르는 필드는 무시한다")
    void resolveWithoutArriveIsTheOldPreview() throws Exception {
        UUID host = newUser();
        UUID open = island("미리보기섬", false, false);
        UUID approval = island("미리보기승인섬", false, true);
        joinAs(host, open, GroupMemberRole.OWNER);
        joinAs(host, approval, GroupMemberRole.OWNER);
        String openCode = invitations.issue(host, open, UUID.randomUUID()).code();
        String approvalCode = invitations.issue(host, approval, UUID.randomUUID()).code();
        UUID user = newUser();
        long openEvents = islandEvents(open);
        long approvalEvents = islandEvents(approval);

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
        assertThat(islandEvents(open)).isEqualTo(openEvents);
        assertThat(islandEvents(approval)).isEqualTo(approvalEvents);
    }

    @Test
    @DisplayName("누구나 가입 섬 — arrive=true 면 해석이 가입·이동·도착까지 한다")
    void openIslandInviteJoinsMovesAndArrives() throws Exception {
        UUID host = newUser();
        UUID islandId = island("초대섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        long memberEvents = memberEvents(islandId);

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
        assertThat(memberEvents(islandId)).isEqualTo(memberEvents + 1);
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
        long islandEvents = islandEvents(islandId);

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("none");
        assertThat(resolved.arrival().reason()).isNull();
        assertThat(resolved.island().membershipStatus()).isEqualTo("none");
        assertThat(resolved.island().arrivedBefore()).isTrue();
        assertThat(arrived(user, islandId)).isTrue();
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user))
                .as("링크를 연 것만으로 섬장의 신청 목록이 차지 않는다").isZero();
        assertThat(currentIsland(user)).as("방문자는 옮기지 않는다").isEqualTo(home);
        assertThat(islandEvents(islandId)).as("도착만은 사건을 만들지 않는다").isEqualTo(islandEvents);

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

        // 열린 신청이 있으면 다시 해석해도 그 신청을 그대로 보여 주고 그 신청의 사건을 만들지 않는다.
        long requestEvents = requestEvents(applied.requestId());
        InvitationResolvedView again = resolve(user, code);
        assertThat(again.arrival().membershipStatus()).isEqualTo("pending");
        assertThat(again.island().joinRequestId()).isEqualTo(applied.requestId());
        assertThat(requestEvents(applied.requestId())).isEqualTo(requestEvents);

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
    @DisplayName("대조군 — 도착 없이(망원경) 승인된 섬은 즉시 이동이 403 ISLAND_NOT_ARRIVED 이고, 승인 편지는 항해 시간을 알린다")
    void telescopeApprovalHasNoInstantMoveAndKeepsTheSailingLetter() throws Exception {
        UUID host = newUser();
        UUID islandId = island("망원승인섬", false, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID user = newUser();
        UUID requestId = joins.join(user, islandId, new JoinIslandCommandRequest(null, "telescope"),
                UUID.randomUUID()).requestId();

        joins.answer(host, islandId, requestId, true, UUID.randomUUID());

        assertThat(arrived(user, islandId)).isFalse();
        assertThat(activeMemberships(user, islandId)).as("승인돼 주민이지만").isEqualTo(1);
        mvc.perform(put("/internal/users/" + user + "/current-island")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content("{\"islandId\":\"" + islandId + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ISLAND_NOT_ARRIVED"));
        assertThat(currentIsland(user)).isNotEqualTo(islandId);
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
    @DisplayName("소속 3개 중 하나가 이 섬이면 상한이 아니라 active 다 — 주민 판정이 상한보다 먼저다")
    void memberAtTheLimitIsActiveNotIslandLimit() {
        UUID host = newUser();
        UUID islandId = island("상한주민섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        joinAs(user, islandId, GroupMemberRole.MEMBER);
        joinAs(user, island("둘째소속섬", false, false), GroupMemberRole.MEMBER);
        joinAs(user, island("셋째소속섬", false, false), GroupMemberRole.MEMBER);

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("active");
        assertThat(resolved.arrival().reason()).isNull();
        assertThat(arrived(user, islandId)).isTrue();
        assertThat(count("select count(*) from group_members where user_id=? and is_left=false", user))
                .isEqualTo(3);
    }

    @Test
    @DisplayName("소속 3개라도 이 섬에 열린 신청이 있으면 상한이 아니라 pending 이다 — 신청 판정이 상한보다 먼저다")
    void openPendingAtTheLimitStaysPending() {
        UUID host = newUser();
        UUID islandId = island("상한신청섬", false, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        UUID requestId = joins.join(user, islandId, new JoinIslandCommandRequest(code), UUID.randomUUID())
                .requestId();
        for (int i = 0; i < 3; i++) {
            joinAs(user, island("가득섬" + i, false, false), GroupMemberRole.MEMBER);
        }
        long requestEvents = requestEvents(requestId);

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("pending");
        assertThat(resolved.arrival().reason()).isNull();
        assertThat(resolved.island().joinRequestId()).isEqualTo(requestId);
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user)).isEqualTo(1);
        assertThat(requestEvents(requestId)).isEqualTo(requestEvents);
        assertThat(arrived(user, islandId)).isTrue();
    }

    @Test
    @DisplayName("강퇴된 섬(누구나 가입·승인제 둘 다) — 도착만 남기고 reason=KICKED, 신청은 도착 뒤 직접 해서 pending 이 된다")
    void kickedUserArrivesWithReasonAndThenApplies() {
        UUID host = newUser();
        UUID user = newUser();
        for (boolean approvalRequired : List.of(false, true)) {
            UUID islandId = island(approvalRequired ? "강퇴승인섬" : "강퇴섬", false, approvalRequired);
            joinAs(host, islandId, GroupMemberRole.OWNER);
            String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
            joinAs(user, islandId, GroupMemberRole.MEMBER);
            jdbc.update("update group_members set is_left=true, left_reason='KICKED'"
                    + " where group_id=? and user_id=?", islandId, user);
            long islandEvents = islandEvents(islandId);

            InvitationResolvedView resolved = resolve(user, code);

            assertThat(resolved.arrival().membershipStatus()).isEqualTo("none");
            assertThat(resolved.arrival().reason()).isEqualTo("KICKED");
            // 누구나 가입 섬이어도 강퇴자에게는 승인제로 보인다 — 가입이 신청이 되기 때문이다.
            assertThat(resolved.island().approvalRequired()).isTrue();
            assertThat(arrived(user, islandId)).isTrue();
            assertThat(activeMemberships(user, islandId)).isZero();
            assertThat(islandEvents(islandId)).isEqualTo(islandEvents);
            // 해석은 신청을 만들지 않는다 — 승인제 섬처럼 방문자가 직접 신청한다.
            assertThat(count("select count(*) from island_join_requests where applicant_id=? and island_id=?",
                    user, islandId)).isZero();

            // 도착 뒤 신청은 403 이 아니라 승인 대기다(GROMO-2315). 다시 해석하면 그 신청을 그대로 보여 준다.
            JoinIslandResultView applied = joins.join(user, islandId, new JoinIslandCommandRequest(code),
                    UUID.randomUUID());
            assertThat(applied.status()).isEqualTo("pending");
            InvitationResolvedView again = resolve(user, code);
            assertThat(again.arrival().membershipStatus()).isEqualTo("pending");
            assertThat(again.arrival().reason()).isNull();
            assertThat(activeMemberships(user, islandId)).isZero();
        }
        assertThat(currentIsland(user)).isNull();
    }

    @Test
    @DisplayName("스스로 나간 섬(강퇴 아님)은 초대로 다시 가입된다 — 같은 멤버십 행이 되살아난다")
    void voluntarilyLeftUserRejoinsAnOpenIsland() {
        UUID host = newUser();
        UUID islandId = island("돌아온섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        joinAs(user, islandId, GroupMemberRole.MEMBER);
        jdbc.update("update group_members set is_left=true, left_reason='LEFT',"
                + " membership_epoch=membership_epoch+1 where group_id=? and user_id=?", islandId, user);
        long memberEvents = memberEvents(islandId);

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("active");
        assertThat(resolved.arrival().reason()).isNull();
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?", islandId, user))
                .as("재가입은 새 행이 아니라 같은 행이다").isEqualTo(1);
        assertThat(activeMemberships(user, islandId)).isEqualTo(1);
        assertThat(currentIsland(user)).isEqualTo(islandId);
        assertThat(memberEvents(islandId)).isEqualTo(memberEvents + 1);
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
        long islandEvents = islandEvents(islandId);

        InvitationResolvedView resolved = resolve(user, code);

        assertThat(resolved.arrival().membershipStatus()).isEqualTo("active");
        assertThat(resolved.arrival().reason()).isNull();
        assertThat(arrived(user, islandId)).isTrue();
        assertThat(currentIsland(user)).isEqualTo(home);
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?", islandId, user))
                .isEqualTo(1);
        assertThat(islandEvents(islandId)).isEqualTo(islandEvents);
    }

    @Test
    @DisplayName("같은 초대를 두 번 해석해도 도착 1행(first 그대로·last 갱신)·멤버십 1건·사건 그대로고, 승인제 섬은 신청이 생기지 않는다")
    void resolvingTwiceIsIdempotent() {
        UUID host = newUser();
        UUID open = island("두번섬", false, false);
        UUID approval = island("두번승인섬", false, true);
        joinAs(host, open, GroupMemberRole.OWNER);
        joinAs(host, approval, GroupMemberRole.OWNER);
        String openCode = invitations.issue(host, open, UUID.randomUUID()).code();
        String approvalCode = invitations.issue(host, approval, UUID.randomUUID()).code();
        UUID user = newUser();

        Instant first = now.get();
        resolve(user, openCode);
        long openEvents = islandEvents(open);
        Instant later = first.plusSeconds(90);
        now.set(later);
        InvitationResolvedView again = resolve(user, openCode);
        assertThat(again.arrival().membershipStatus()).isEqualTo("active");
        assertThat(count("select count(*) from island_arrivals where user_id=? and island_id=?", user, open))
                .isEqualTo(1);
        assertThat(arrivedAt("first_arrived_at", user, open)).isEqualTo(first);
        assertThat(arrivedAt("last_arrived_at", user, open)).isEqualTo(later);
        assertThat(activeMemberships(user, open)).isEqualTo(1);
        assertThat(islandEvents(open)).as("두 번째 해석은 그 섬의 사건을 만들지 않는다").isEqualTo(openEvents);

        long approvalEvents = islandEvents(approval);
        for (int i = 0; i < 2; i++) {
            assertThat(resolve(user, approvalCode).arrival().membershipStatus()).isEqualTo("none");
        }
        assertThat(count("select count(*) from island_arrivals where user_id=? and island_id=?", user, approval))
                .isEqualTo(1);
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", user)).isZero();
        assertThat(islandEvents(approval)).isEqualTo(approvalEvents);
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
    @DisplayName("잠금 아래 거절 — 발급자 세대 어긋남·종결 섬 410, 없는 코드 404, 형식 오류 422 는 도착·멤버십·사건을 남기지 않는다")
    void rejectedInvitationsLeaveNoArrival() throws Exception {
        UUID host = newUser();
        UUID stale = island("세대어긋섬", false, false);
        UUID closed = island("종결초대섬", false, false);
        joinAs(host, stale, GroupMemberRole.OWNER);
        joinAs(host, closed, GroupMemberRole.OWNER);
        String staleCode = invitations.issue(host, stale, UUID.randomUUID()).code();
        String closedCode = invitations.issue(host, closed, UUID.randomUUID()).code();
        // 발급 뒤 발급자의 세대가 바뀌면(이탈·재가입) 그 코드는 폐기다 — 섬 종결도 같은 410 이다.
        jdbc.update("update group_members set membership_epoch=membership_epoch+1"
                + " where group_id=? and user_id=?", stale, host);
        jdbc.update("update islands set status='ENDED' where id=?", closed);
        UUID user = newUser();
        long staleEvents = islandEvents(stale);
        long closedEvents = islandEvents(closed);

        expectResolveRejected(user, staleCode, 410, "INVITATION_EXPIRED");
        expectResolveRejected(user, closedCode, 410, "INVITATION_EXPIRED");
        expectResolveRejected(user, "zzzzzzzz", 404, "SLUG_NOT_FOUND");
        expectResolveRejected(user, "hello!", 422, "INVITATION_CODE_INVALID");

        assertThat(count("select count(*) from island_arrivals where user_id=?", user)).isZero();
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(currentIsland(user)).isNull();
        assertThat(islandEvents(stale)).isEqualTo(staleEvents);
        assertThat(islandEvents(closed)).isEqualTo(closedEvents);
    }

    @Test
    @DisplayName("계약에 사유가 없는 가입 거절(진행 중 집중)은 그대로 전파되고 도착·멤버십·이동·사건·편지가 남지 않는다")
    void unlistedJoinRejectionPropagatesAndLeavesNoArrival() {
        UUID host = newUser();
        UUID islandId = island("집중중초대섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("집중섬", null, false, null),
                UUID.randomUUID()).id();
        jdbc.update("INSERT INTO focus_sessions (id, user_id, started_at, total_distraction_seconds) VALUES (?, ?, now(), 0)",
                UUID.randomUUID(), user);
        long islandEvents = islandEvents(islandId);

        assertThatThrownBy(() -> resolve(user, code))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertNothingLeft(user, islandId, home, islandEvents);
    }

    @Test
    @DisplayName("정원이 찬 누구나 가입 섬도 ROOM_FULL 로 전파되고 도착·멤버십·이동·사건·편지가 남지 않는다")
    void fullIslandRejectionPropagatesAndLeavesNoArrival() {
        UUID host = newUser();
        UUID islandId = island("만원초대섬", false, false, 1);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(host, islandId, UUID.randomUUID()).code();
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("만원집섬", null, false, null),
                UUID.randomUUID()).id();
        long islandEvents = islandEvents(islandId);

        assertThatThrownBy(() -> resolve(user, code))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.ROOM_FULL);
        assertNothingLeft(user, islandId, home, islandEvents);
    }

    @Test
    @DisplayName("주민 첫 도착 사건 스위치가 꺼져 있으면(기본) 사건은 0건이고 arrivedBefore 는 그대로 계산한다 (GROMO-2302)")
    void firstMemberArrivalWithTheSwitchOffPublishesNothing() {
        UUID host = newUser();
        UUID islandId = island("스위치섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID user = newUser();
        joins.join(user, islandId, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        // 고정 시계(초 내림)는 가입 행의 created_at(벽시계)보다 이르다 — 기록이 GREATEST(now, 멤버십 시작)이라
        // 두 번째 도착이 «첫 도착» 으로 되돌아가지 않는다.

        assertThat(islands.arrive(user, islandId, UUID.randomUUID()).arrivedBefore()).isFalse();
        assertThat(islands.arrive(user, islandId, UUID.randomUUID()).arrivedBefore()).isTrue();
        assertThat(count("select count(*) from event_outbox where type='island.member.arrived' and subject_id=?",
                islandId.toString())).isZero();
    }

    @Test
    @DisplayName("방문 중 가입 직후의 도착은 첫 도착이 아니다 — 시계가 가입 행 created_at 보다 일러도 (GROMO-2302)")
    void arrivalRightAfterAVisitJoinIsNotAFirstArrival() {
        UUID host = newUser();
        UUID islandId = island("방문가입섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID user = newUser();
        // 가입 트랜잭션은 now 를 가입 행 INSERT(@CreationTimestamp, flush 때 벽시계) 보다 먼저 읽는다 — 그 순서를
        // 결정적으로 만들려고 시계를 몇 초 뒤로 둔다.
        now.set(Instant.now().minusSeconds(5));
        joins.join(user, islandId, new JoinIslandCommandRequest(null, "visit"), UUID.randomUUID());
        assertThat(jdbc.queryForObject("select m.created_at <= a.member_arrived_at from group_members m "
                + "join island_arrivals a on a.user_id=m.user_id and a.island_id=m.group_id "
                + "where m.user_id=? and m.group_id=?", Boolean.class, user, islandId))
                .as("주민 도착 기록은 멤버십 시작 이후다").isTrue();

        assertThat(islands.arrive(user, islandId, UUID.randomUUID()).arrivedBefore()).isTrue();
        assertThat(count("select count(*) from event_outbox where type='island.member.arrived' and subject_id=?",
                islandId.toString())).isZero();
    }

    // ---------------------------------------------------------------- 도구

    /** 도착 해석(arrive=true) — 이 클래스의 기본 시나리오다. */
    private InvitationResolvedView resolve(UUID userId, String code) {
        return resolve(userId, code, true);
    }

    private InvitationResolvedView resolve(UUID userId, String code, Boolean arrive) {
        return invitations.resolve(userId, new InvitationResolveCommandRequest(code, arrive));
    }

    private void expectResolveRejected(UUID userId, String code, int httpStatus, String errorCode) throws Exception {
        mvc.perform(post("/internal/users/" + userId + "/invitations/resolve")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", userId)
                        .contentType("application/json").content("{\"code\":\"" + code + "\",\"arrive\":true}"))
                .andExpect(status().is(httpStatus))
                .andExpect(jsonPath("$.code").value(errorCode));
    }

    /** 전파된 가입 거절 뒤 — 도착·멤버십·현재 섬 이동·그 섬 사건(island.members.updated 포함)·편지가 하나도 남지 않았다. */
    private void assertNothingLeft(UUID userId, UUID islandId, UUID home, long islandEventsBefore) {
        assertThat(arrived(userId, islandId)).isFalse();
        assertThat(activeMemberships(userId, islandId)).isZero();
        assertThat(currentIsland(userId)).isEqualTo(home);
        assertThat(islandEvents(islandId)).isEqualTo(islandEventsBefore);
        assertThat(memberEvents(islandId)).isZero();
        assertThat(count("select count(*) from letters where receiver_id=?", userId)).isZero();
    }

    private String approvalLetter(UUID userId) {
        return jdbc.queryForObject("select content from letters where receiver_id=? and kind='JOIN_APPROVED'",
                String.class, userId);
    }

    private boolean arrived(UUID userId, UUID islandId) {
        return count("select count(*) from island_arrivals where user_id=? and island_id=?", userId, islandId) == 1;
    }

    /** {@code first_arrived_at} 또는 {@code last_arrived_at} — 열 이름은 이 클래스의 상수 문자열만 넘긴다. */
    private Instant arrivedAt(String column, UUID userId, UUID islandId) {
        return jdbc.queryForObject("select " + column + " from island_arrivals where user_id=? and island_id=?",
                Timestamp.class, userId, islandId).toInstant();
    }

    private long activeMemberships(UUID userId, UUID islandId) {
        return count("select count(*) from group_members where group_id=? and user_id=? and is_left=false",
                islandId, userId);
    }

    private long memberEvents(UUID islandId) {
        return count("select count(*) from event_outbox where subject_id=? and type='island.members.updated'",
                islandId.toString());
    }

    /** 그 섬을 주제로 한 사건 전부 — 주민 목록·가입 신청 등. 전후 비교로만 쓴다. */
    private long islandEvents(UUID islandId) {
        return count("select count(*) from event_outbox where subject_id=?", islandId.toString());
    }

    /** 그 가입 신청을 순서 축으로 한 사건 — {@code join.request.updated} 의 aggregate 는 신청 id 다. */
    private long requestEvents(UUID requestId) {
        return count("select count(*) from event_outbox where type='join.request.updated' and aggregate_id=?",
                requestId.toString());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private UUID island(String name, boolean isPrivate, boolean approvalRequired) {
        return island(name, isPrivate, approvalRequired, 10);
    }

    private UUID island(String name, boolean isPrivate, boolean approvalRequired, int maxMembers) {
        return groups.save(Group.builder().name(name).description(null).maxMembers(maxMembers)
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

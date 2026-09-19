package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.internal.dto.IslandJoinRequestsPageView;
import com.oneorthree.phone.internal.dto.IslandLeftView;
import com.oneorthree.phone.internal.dto.IslandManageCommandRequest;
import com.oneorthree.phone.internal.dto.IslandManageView;
import com.oneorthree.phone.internal.dto.IslandMemberRemovedView;
import com.oneorthree.phone.internal.dto.IslandMembersPageView;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinRequestAnswerView;
import com.oneorthree.phone.internal.service.IslandInvitationService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 관리·주민 잔여 6종 (GROMO-1802)을 <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점으로 검증한다.
 *
 * <p>권한 행렬의 칸(방장·주민·방문자·pending 신청자·다른 섬 방장·삭제 계정)을 계약마다 채우고, 기능 게이트·
 * 멱등 재생·승인 정원·경합·이탈 가드를 본다. 시드는 전부 생산 엔티티·서비스로 만든다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandManagementIntegrationTest {

    private static final String TOKEN = "test-island-management-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"PATCH /internal/islands/*", "GET /internal/islands/*/members",
            "GET /internal/islands/*/join-requests", "PATCH /internal/islands/*/join-requests/*",
            "DELETE /internal/islands/*/members/*", "DELETE /internal/users/*/islands/*/membership"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @Autowired
    IslandManagementService management;
    @Autowired
    IslandJoinService joins;
    @Autowired
    IslandInvitationService invitations;
    @Autowired
    GroupMemberService memberService;
    @Autowired
    FocusService legacyFocus;
    @Autowired
    AccountWithdrawalService withdrawal;
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

    // ---------------------------------------------------------------- 게이트

    @Test
    @DisplayName("게이트가 꺼지면 명령 4종은 receipt·쓰기·사건보다 먼저 503 이고 조회 둘은 그대로 열린다")
    void disabledGateRejectsEveryCommandBeforeAnyWrite() {
        Fixture f = fixture(true);
        UUID request = pendingRequest(f.islandId());
        long receipts = count("select count(*) from command_idempotency");
        long outbox = count("select count(*) from event_outbox");
        ReflectionTestUtils.setField(management, "enabled", false);
        ReflectionTestUtils.setField(joins, "managementEnabled", false);
        try {
            List<Runnable> commands = List.of(
                () -> management.manage(f.host(), f.islandId(),
                        new IslandManageCommandRequest("새이름", null, null), UUID.randomUUID()),
                () -> joins.answer(f.host(), f.islandId(), request, true, UUID.randomUUID()),
                () -> management.kick(f.host(), f.islandId(), f.member(), UUID.randomUUID()),
                () -> management.leave(f.member(), f.islandId(), UUID.randomUUID()));
            for (Runnable command : commands) {
                assertThatThrownBy(command::run)
                        .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.ISLAND_MANAGEMENT_NOT_READY);
            }
            assertThat(management.members(f.host(), f.islandId(), null, null, 30).items()).hasSize(2);
            assertThat(management.joinRequests(f.host(), f.islandId(), null, null, 30).items()).hasSize(1);
        } finally {
            ReflectionTestUtils.setField(management, "enabled", true);
            ReflectionTestUtils.setField(joins, "managementEnabled", true);
        }
        assertThat(count("select count(*) from command_idempotency")).isEqualTo(receipts);
        assertThat(count("select count(*) from event_outbox")).isEqualTo(outbox);
        assertThat(requestStatus(request)).isEqualTo("PENDING");
        assertThat(active(f.islandId(), f.member())).isTrue();
    }

    // ---------------------------------------------------------------- §3.1 manage

    @Test
    @DisplayName("정보 수정 — 방장만, 누락 필드 보존, 실제 변경에만 island.updated 와 이름 변경 링크 사건")
    void manageUpdatesOnlyGivenFieldsAndRecordsOneEvent() throws Exception {
        Fixture f = fixture(false);
        mvc.perform(patch("/internal/islands/" + f.islandId()).header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", f.host()).header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content("{\"name\":\"바뀐섬\",\"approvalRequired\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(f.islandId().toString()))
                .andExpect(jsonPath("$.name").value("바뀐섬"))
                .andExpect(jsonPath("$.intro").value(""))
                .andExpect(jsonPath("$.approvalRequired").value(true))
                .andExpect(jsonPath("$.version").value(1));
        assertThat(count("select count(*) from event_outbox where subject_id=? and type='island.updated'",
                f.islandId().toString())).isEqualTo(1);
        long renamed = count("select count(*) from event_outbox where params->>'groupId'=? and type='group.renamed'",
                f.islandId().toString());

        // 같은 값·빈 PATCH 는 no-op — 사건도 버전도 늘지 않는다.
        IslandManageView same = management.manage(f.host(), f.islandId(),
                new IslandManageCommandRequest("바뀐섬", null, true), UUID.randomUUID());
        IslandManageView empty = management.manage(f.host(), f.islandId(),
                new IslandManageCommandRequest(null, null, null), UUID.randomUUID());
        assertThat(same.version()).isEqualTo(1);
        assertThat(empty.version()).isEqualTo(1);
        // 소개만 바꾸면 island.updated 는 늘지만 링크 이름 사건은 늘지 않는다.
        IslandManageView intro = management.manage(f.host(), f.islandId(),
                new IslandManageCommandRequest(null, "소개", null), UUID.randomUUID());
        assertThat(intro).isEqualTo(new IslandManageView(f.islandId(), "바뀐섬", "소개", true, 2));
        assertThat(count("select count(*) from event_outbox where subject_id=? and type='island.updated'",
                f.islandId().toString())).isEqualTo(2);
        assertThat(count("select count(*) from event_outbox where params->>'groupId'=? and type='group.renamed'",
                f.islandId().toString())).isEqualTo(renamed);
    }

    @Test
    @DisplayName("정보 수정 — 주민·방문자·다른 섬 방장은 403, 명시 null·계약 밖 필드는 400")
    void manageRejectsNonHostsAndBadBodies() throws Exception {
        Fixture f = fixture(false);
        UUID visitor = newUser();
        UUID otherHost = newUser();
        joinAs(otherHost, publicIsland("다른섬"), GroupMemberRole.OWNER);
        for (UUID caller : List.of(f.member(), visitor, otherHost)) {
            assertThatThrownBy(() -> management.manage(caller, f.islandId(),
                    new IslandManageCommandRequest("탈취", null, null), UUID.randomUUID()))
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_OWNER);
        }
        for (String body : List.of("{\"name\":null}", "{\"password\":\"1234\"}", "{\"approvalRequired\":\"yes\"}",
                "{\"name\":\"" + "가".repeat(51) + "\"}")) {
            mvc.perform(patch("/internal/islands/" + f.islandId()).header("Authorization", "Bearer " + TOKEN)
                            .header("X-User-Id", f.host()).header("Idempotency-Key", UUID.randomUUID())
                            .contentType("application/json").content(body))
                    .andExpect(status().isBadRequest());
        }
        assertThat(groups.findById(f.islandId()).orElseThrow().getName()).isEqualTo("관리섬");
    }

    // ---------------------------------------------------------------- §3.2 members

    @Test
    @DisplayName("주민 목록 — 주민만 읽고, 가입순 keyset 페이지와 같은 스냅샷의 목록 version 을 준다")
    void membersPagesInJoinOrderWithListVersion() throws Exception {
        Fixture f = fixture(false);
        long version = management.members(f.host(), f.islandId(), null, null, 30).version();

        IslandMembersPageView first = management.members(f.member(), f.islandId(), null, null, 1);
        assertThat(first.items()).extracting(IslandMembersPageView.Item::id).containsExactly(f.host());
        assertThat(first.items().get(0).role()).isEqualTo("host");
        assertThat(first.nextJoinedAt()).isNotNull();
        IslandMembersPageView second = management.members(f.member(), f.islandId(),
                first.nextJoinedAt(), first.nextMembershipId(), 1);
        assertThat(second.items()).extracting(IslandMembersPageView.Item::role).containsExactly("member");
        assertThat(second.nextJoinedAt()).isNull();
        assertThat(second.version()).isEqualTo(version);

        mvc.perform(get("/internal/islands/" + f.islandId() + "/members").param("limit", "30")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", f.member()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.version").value(version));
    }

    @Test
    @DisplayName("주민 목록 — 방문자·pending 신청자·다른 섬 방장은 403, 삭제 계정은 목록에서 빠지고 본인 호출은 404")
    void membersRejectsOutsidersAndHidesDeletedAccounts() {
        Fixture f = fixture(true);
        UUID applicant = newUser();
        joins.join(applicant, f.islandId(), null, UUID.randomUUID());
        UUID otherHost = newUser();
        joinAs(otherHost, publicIsland("다른섬"), GroupMemberRole.OWNER);
        for (UUID caller : List.of(newUser(), applicant, otherHost)) {
            assertThatThrownBy(() -> management.members(caller, f.islandId(), null, null, 30))
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        }
        withdrawal.withdraw(f.member());
        assertThat(management.members(f.host(), f.islandId(), null, null, 30).items())
                .extracting(IslandMembersPageView.Item::id).containsExactly(f.host());
        assertThatThrownBy(() -> management.members(f.member(), f.islandId(), null, null, 30))
                .hasFieldOrPropertyWithValue("errorCode", UserErrorCode.USER_NOT_FOUND);
    }

    // ---------------------------------------------------------------- §3.3 requests

    @Test
    @DisplayName("신청자 목록 — 방장만 pending 을 본다. 주민·pending 신청자·다른 섬 방장은 403")
    void joinRequestsIsHostOnlyAndPendingOnly() throws Exception {
        Fixture f = fixture(true);
        UUID first = pendingRequest(f.islandId());
        UUID second = pendingRequest(f.islandId());
        UUID applicant = applicantOf(second);
        joins.answer(f.host(), f.islandId(), first, false, UUID.randomUUID());

        IslandJoinRequestsPageView page = management.joinRequests(f.host(), f.islandId(), null, null, 30);
        assertThat(page.items()).extracting(IslandJoinRequestsPageView.Item::id).containsExactly(second);
        assertThat(page.items().get(0).applicantId()).isEqualTo(applicant);
        assertThat(page.items().get(0).status()).isEqualTo("pending");

        UUID otherHost = newUser();
        joinAs(otherHost, publicIsland("다른섬"), GroupMemberRole.OWNER);
        for (UUID caller : List.of(f.member(), applicant, otherHost)) {
            assertThatThrownBy(() -> management.joinRequests(caller, f.islandId(), null, null, 30))
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_OWNER);
        }
        mvc.perform(get("/internal/islands/" + f.islandId() + "/join-requests").param("limit", "30")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", f.host()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(second.toString()));
    }

    // ---------------------------------------------------------------- §3.4 request-answer

    @Test
    @DisplayName("승인 — 요청 approved·멤버십·주민/요청 사건을 한 트랜잭션에 남기고 현재 섬은 바꾸지 않는다")
    void approveAdmitsTheApplicantAtomically() throws Exception {
        Fixture f = fixture(true);
        UUID request = pendingRequest(f.islandId());
        UUID applicant = applicantOf(request);
        long before = count("select count(*) from event_outbox where subject_id=?", request.toString());

        mvc.perform(patch("/internal/islands/" + f.islandId() + "/join-requests/" + request)
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", f.host())
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content("{\"decision\":\"approve\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.memberId").value(applicant.toString()))
                .andExpect(jsonPath("$.version").value(1));

        assertThat(requestStatus(request)).isEqualTo("APPROVED");
        assertThat(active(f.islandId(), applicant)).isTrue();
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and type='join.request.updated'", request.toString())).isEqualTo(before + 2);
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and params->>'changeKind'='MEMBER_ADDED'", f.islandId().toString())).isEqualTo(1);
        assertThat(count("select count(*) from user_island_contexts where user_id=?"
                + " and current_island_id=?", applicant, f.islandId())).isZero();
    }

    @Test
    @DisplayName("거절·정원 — 만원에서도 거절은 되고 승인은 409, 거절은 멤버십·주민 사건을 만들지 않는다")
    void rejectWorksWhenFullAndApproveChecksCapacityUnderLock() {
        UUID host = newUser();
        UUID islandId = island("만원섬", false, 1, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID first = pendingRequest(islandId);
        UUID second = pendingRequest(islandId);

        assertThatThrownBy(() -> joins.answer(host, islandId, first, true, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.ROOM_FULL);
        JoinRequestAnswerView rejected = joins.answer(host, islandId, second, false, UUID.randomUUID());

        assertThat(rejected).isEqualTo(new JoinRequestAnswerView("rejected", null, 1));
        assertThat(requestStatus(first)).isEqualTo("PENDING");
        assertThat(count("select count(*) from group_members where group_id=? and is_left=false", islandId))
                .isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where subject_id=? and type='island.members.updated'",
                islandId.toString())).isZero();
    }

    @Test
    @DisplayName("승인/거절 — 같은 키는 재생, 다른 키로 끝난 요청은 409, 다른 섬 요청은 404, 방장 아닌 호출은 403")
    void answerReplaysAndRejectsTerminalForeignAndNonHost() {
        Fixture f = fixture(true);
        UUID request = pendingRequest(f.islandId());
        UUID applicant = applicantOf(request);
        UUID key = UUID.randomUUID();

        JoinRequestAnswerView first = joins.answer(f.host(), f.islandId(), request, true, key);
        JoinRequestAnswerView replay = joins.answer(f.host(), f.islandId(), request, true, key);
        assertThat(replay).isEqualTo(first);
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and params->>'changeKind'='MEMBER_ADDED'", f.islandId().toString())).isEqualTo(1);
        assertThatThrownBy(() -> joins.answer(f.host(), f.islandId(), request, false, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.JOIN_REQUEST_TERMINAL);

        UUID otherIsland = island("남의섬", false, 10, true);
        joinAs(newUser(), otherIsland, GroupMemberRole.OWNER);
        UUID foreign = pendingRequest(otherIsland);
        assertThatThrownBy(() -> joins.answer(f.host(), f.islandId(), foreign, true, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.JOIN_REQUEST_NOT_FOUND);

        UUID open = pendingRequest(f.islandId());
        for (UUID caller : List.of(f.member(), applicant, applicantOf(open), newUser())) {
            assertThatThrownBy(() -> joins.answer(caller, f.islandId(), open, true, UUID.randomUUID()))
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_OWNER);
        }
        assertThat(requestStatus(open)).isEqualTo("PENDING");
    }

    @Test
    @DisplayName("승인 — 초대 근거의 발급자가 떠났으면 410 이고 거절은 그래도 된다")
    void approveRevalidatesInvitationEvidence() {
        UUID host = newUser();
        UUID issuer = newUser();
        UUID islandId = island("초대승인섬", true, 10, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        joinAs(issuer, islandId, GroupMemberRole.MEMBER);
        String code = invitations.issue(issuer, islandId, UUID.randomUUID()).code();
        UUID applicant = newUser();
        UUID request = joins.join(applicant, islandId, new JoinIslandCommandRequest(code), UUID.randomUUID())
                .requestId();
        memberService.withdrawGroup(islandId, issuer);

        assertThatThrownBy(() -> joins.answer(host, islandId, request, true, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.INVITATION_EXPIRED);
        assertThat(joins.answer(host, islandId, request, false, UUID.randomUUID()).status()).isEqualTo("rejected");
        assertThat(active(islandId, applicant)).isFalse();
    }

    @Test
    @DisplayName("경합 — 같은 요청의 승인과 신청자 취소가 동시에 와도 한 전이만 이긴다")
    void approveAndCancelRaceHasExactlyOneWinner() throws Exception {
        Fixture f = fixture(true);
        UUID request = pendingRequest(f.islandId());
        UUID applicant = applicantOf(request);
        List<Throwable> failures = race(
                () -> joins.answer(f.host(), f.islandId(), request, true, UUID.randomUUID()),
                () -> joins.cancel(applicant, request, UUID.randomUUID()));

        assertThat(failures).hasSize(1);
        assertThat(failures.get(0)).hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.JOIN_REQUEST_TERMINAL);
        boolean approved = "APPROVED".equals(requestStatus(request));
        assertThat(active(f.islandId(), applicant)).isEqualTo(approved);
    }

    // ---------------------------------------------------------------- §3.6 kick

    @Test
    @DisplayName("강퇴 — 방장만, 자기 자신 409, 대상 부재 404, 같은 키 재생은 사건을 한 번만 남긴다")
    void kickFollowsTheLegacyRulesAndReplays() throws Exception {
        Fixture f = fixture(false);
        UUID key = UUID.randomUUID();
        mvc.perform(delete("/internal/islands/" + f.islandId() + "/members/" + f.member())
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", f.host())
                        .header("Idempotency-Key", key))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.removed").value(true));
        assertThat(management.kick(f.host(), f.islandId(), f.member(), key))
                .isEqualTo(new IslandMemberRemovedView(true));
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?"
                + " and left_reason='KICKED'", f.islandId(), f.member())).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and params->>'changeKind'='MEMBER_REMOVED'", f.islandId().toString())).isEqualTo(1);

        assertThatThrownBy(() -> management.kick(f.host(), f.islandId(), f.member(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> management.kick(f.host(), f.islandId(), f.host(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.CANNOT_KICK_SELF);
    }

    @Test
    @DisplayName("강퇴 — 주민·방문자·pending 신청자·다른 섬 방장은 403, 삭제 계정 대상은 404")
    void kickRejectsNonHostsAndDeletedTargets() {
        Fixture f = fixture(true);
        UUID second = newUser();
        joinAs(second, f.islandId(), GroupMemberRole.MEMBER);
        UUID applicant = applicantOf(pendingRequest(f.islandId()));
        UUID otherHost = newUser();
        joinAs(otherHost, publicIsland("다른섬"), GroupMemberRole.OWNER);
        for (UUID caller : List.of(f.member(), newUser(), applicant, otherHost)) {
            assertThatThrownBy(() -> management.kick(caller, f.islandId(), second, UUID.randomUUID()))
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_OWNER);
        }
        withdrawal.withdraw(second);
        assertThatThrownBy(() -> management.kick(f.host(), f.islandId(), second, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", UserErrorCode.TARGET_USER_NOT_FOUND);
        assertThat(active(f.islandId(), f.member())).isTrue();
    }

    // ---------------------------------------------------------------- §3.7 leave

    @Test
    @DisplayName("나가기 — 주민은 떠나고 같은 키 재생은 left:true, 새 키는 미소속 403")
    void memberLeavesAndReplayReturnsTheMinimalEvidence() throws Exception {
        Fixture f = fixture(false);
        UUID key = UUID.randomUUID();
        mvc.perform(delete("/internal/users/" + f.member() + "/islands/" + f.islandId() + "/membership")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", f.member())
                        .header("Idempotency-Key", key))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.left").value(true));
        assertThat(active(f.islandId(), f.member())).isFalse();
        assertThat(management.leave(f.member(), f.islandId(), key)).isEqualTo(new IslandLeftView(true));
        assertThatThrownBy(() -> management.leave(f.member(), f.islandId(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and params->>'changeKind'='MEMBER_REMOVED'", f.islandId().toString())).isEqualTo(1);
    }

    @Test
    @DisplayName("나가기 — 진행 중 집중은 409, 다인 방장은 위임 선행(HOST_WITHDRAW), 방문자는 403")
    void leaveGuardsLiveSessionHostAndVisitor() {
        Fixture f = fixture(false);
        legacyFocus.startFocusSession(f.member(), new FocusSessionStartRequest(null, null));

        assertThatThrownBy(() -> management.leave(f.member(), f.islandId(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThatThrownBy(() -> management.leave(f.host(), f.islandId(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.HOST_WITHDRAW);
        assertThatThrownBy(() -> management.leave(newUser(), f.islandId(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        assertThat(active(f.islandId(), f.member())).isTrue();
        assertThat(active(f.islandId(), f.host())).isTrue();
    }

    @Test
    @DisplayName("나가기 — 마지막 주민이면 섬이 닫히고 pending 전건 cancelled, island.updated 가 같은 TX 에 남는다")
    void lastMemberLeaveClosesTheIsland() {
        UUID host = newUser();
        UUID islandId = island("마지막섬", false, 10, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID request = pendingRequest(islandId);

        management.leave(host, islandId, UUID.randomUUID());

        assertThat(groups.findById(islandId).orElseThrow().getStatus()).isEqualTo(GroupStatus.ENDED);
        assertThat(requestStatus(request)).isEqualTo("CANCELLED");
        assertThat(count("select count(*) from island_join_requests where id=? and terminal_reason='ISLAND_CLOSED'",
                request)).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where subject_id=? and type='island.updated'"
                + " and params->>'changeKind'='CLOSED'", islandId.toString())).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 재생 인가

    @Test
    @DisplayName("방장 명령 3종의 같은 키 재생도 지금 방장이어야 한다 — 강등된 이전 방장은 403 NOT_OWNER")
    void hostCommandReplaysRecheckCurrentHost() {
        Fixture f = fixture(true);
        UUID second = newUser();
        joinAs(second, f.islandId(), GroupMemberRole.MEMBER);
        UUID request = pendingRequest(f.islandId());
        UUID manageKey = UUID.randomUUID();
        UUID answerKey = UUID.randomUUID();
        UUID kickKey = UUID.randomUUID();
        IslandManageCommandRequest rename = new IslandManageCommandRequest("재생섬", null, null);
        management.manage(f.host(), f.islandId(), rename, manageKey);
        joins.answer(f.host(), f.islandId(), request, false, answerKey);
        management.kick(f.host(), f.islandId(), second, kickKey);

        jdbc.update("update group_members set role='MEMBER' where group_id=? and user_id=?", f.islandId(), f.host());

        assertThatThrownBy(() -> management.manage(f.host(), f.islandId(), rename, manageKey))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_OWNER);
        assertThatThrownBy(() -> joins.answer(f.host(), f.islandId(), request, false, answerKey))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_OWNER);
        assertThatThrownBy(() -> management.kick(f.host(), f.islandId(), second, kickKey))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_OWNER);
    }

    // ---------------------------------------------------------------- 도구

    private record Fixture(UUID islandId, UUID host, UUID member) {
    }

    private Fixture fixture(boolean approvalRequired) {
        UUID host = newUser();
        UUID member = newUser();
        UUID islandId = island("관리섬", false, 10, approvalRequired);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        joinAs(member, islandId, GroupMemberRole.MEMBER);
        return new Fixture(islandId, host, member);
    }

    /** 새 신청자가 생산 가입 경로로 pending 을 만든다. */
    private UUID pendingRequest(UUID islandId) {
        return joins.join(newUser(), islandId, null, UUID.randomUUID()).requestId();
    }

    private UUID applicantOf(UUID requestId) {
        return jdbc.queryForObject("select applicant_id from island_join_requests where id=?", UUID.class, requestId);
    }

    private String requestStatus(UUID requestId) {
        return jdbc.queryForObject("select status from island_join_requests where id=?", String.class, requestId);
    }

    private boolean active(UUID islandId, UUID userId) {
        return count("select count(*) from group_members where group_id=? and user_id=? and is_left=false",
                islandId, userId) == 1;
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private UUID publicIsland(String name) {
        return island(name, false, 10, false);
    }

    private UUID island(String name, boolean isPrivate, int maxMembers, boolean approvalRequired) {
        return groups.save(Group.builder().name(name).description(null).maxMembers(maxMembers)
                .isPrivate(isPrivate).approvalRequired(approvalRequired)
                .status(GroupStatus.WAITING).build()).getId();
    }

    private void joinAs(UUID userId, UUID islandId, GroupMemberRole role) {
        User user = users.getCaller(userId);
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island).role(role).build());
    }

    /** 두 명령을 동시에 출발시키고 실패만 모은다. */
    private List<Throwable> race(Callable<?> left, Callable<?> right) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (Callable<?> task : List.of(left, right)) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return task.call();
                }));
            }
            start.countDown();
            List<Throwable> failures = new ArrayList<>();
            for (Future<?> future : futures) {
                try {
                    future.get(30, TimeUnit.SECONDS);
                } catch (java.util.concurrent.ExecutionException e) {
                    failures.add(e.getCause());
                }
            }
            return failures;
        } finally {
            pool.shutdownNow();
        }
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}

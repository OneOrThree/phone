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
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.InvitationResolveCommandRequest;
import com.oneorthree.phone.internal.dto.InvitationResolvedView;
import com.oneorthree.phone.internal.dto.IslandInvitationIssuedView;
import com.oneorthree.phone.internal.dto.IslandViewResponse;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandResultView;
import com.oneorthree.phone.internal.dto.JoinRequestCancelView;
import com.oneorthree.phone.internal.dto.JoinRequestStatusView;
import com.oneorthree.phone.internal.service.IslandInvitationService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 가입·가입 요청·초대 코드 (GROMO-1760)를 <b>실제 Flyway PostgreSQL(V63)</b> 위에서 검증한다.
 *
 * <p>부분 유니크 인덱스·잠금이 네이티브 SQL 이라 인메모리 DB 로는 의미가 없다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandJoinIntegrationTest {

    private static final String TOKEN = "test-island-join-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]",
                () -> "POST /internal/users/*/islands/*/memberships");
        registry.add("internal.api.callers.business.allow[1]",
                () -> "GET /internal/users/*/join-requests/*");
        registry.add("internal.api.callers.business.allow[2]",
                () -> "DELETE /internal/users/*/join-requests/*");
        registry.add("internal.api.callers.business.allow[3]",
                () -> "POST /internal/users/*/invitations/resolve");
        registry.add("internal.api.callers.business.allow[4]",
                () -> "POST /internal/users/*/islands/*/invitations");
    }

    @Autowired
    IslandJoinService joins;
    @Autowired
    IslandInvitationService invitations;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    FocusService legacyFocus;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    GroupInviteLinkRepository inviteLinks;
    @Autowired
    GroupMemberService memberService;
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

    // ---------------------------------------------------------------- §3.7 즉시 가입

    @Test
    @DisplayName("즉시 가입은 멤버십·현재 섬 이동·주민 사건을 한 트랜잭션에 남긴다")
    void immediateJoinMovesCurrentIslandAndEmitsMemberEvent() {
        UUID applicant = newUser();
        UUID islandId = publicIsland("즉시섬");

        JoinIslandResultView result = joins.join(applicant, islandId, null, UUID.randomUUID());

        assertThat(result.status()).isEqualTo("active");
        assertThat(result.requestId()).isNull();
        assertThat(result.currentIslandId()).isEqualTo(islandId);
        assertThat(result.version()).isPositive();
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?"
                + " and is_left=false", islandId, applicant)).isEqualTo(1);
        assertThat(currentIsland(applicant)).isEqualTo(islandId);
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and type='island.members.updated'", islandId.toString())).isEqualTo(1);
    }

    @Test
    @DisplayName("재가입은 행 재삽입이 아니라 기존 행을 되살리고 멤버십 세대가 오른다")
    void rejoinRevivesTheExistingRowAndBumpsEpoch() {
        UUID user = newUser();
        UUID islandId = publicIsland("재가입섬");
        joinAs(user, islandId, GroupMemberRole.MEMBER);
        jdbc.update("update group_members set is_left=true, left_reason='LEFT',"
                + " membership_epoch=membership_epoch+1 where group_id=? and user_id=?",
                islandId, user);

        JoinIslandResultView result = joins.join(user, islandId, null, UUID.randomUUID());

        assertThat(result.status()).isEqualTo("active");
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?",
                islandId, user)).as("unique(user,group) — 행은 하나다").isEqualTo(1);
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?"
                + " and is_left=false and membership_epoch>1", islandId, user)).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 키·같은 본문은 원 응답을 재생하고 멤버십·사건을 두 번 만들지 않는다")
    void sameKeyAndBodyReplaysTheOriginalJoin() {
        UUID applicant = newUser();
        UUID islandId = publicIsland("멱등섬");
        UUID key = UUID.randomUUID();

        JoinIslandResultView first = joins.join(applicant, islandId, null, key);
        JoinIslandResultView replay = joins.join(applicant, islandId, null, key);

        assertThat(replay).isEqualTo(first);
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?",
                islandId, applicant)).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and type='island.members.updated'", islandId.toString())).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 키에 다른 본문은 409 다")
    void sameKeyWithDifferentBodyConflicts() {
        UUID applicant = newUser();
        UUID islandId = publicIsland("충돌섬");
        UUID key = UUID.randomUUID();
        joins.join(applicant, islandId, null, key);

        assertThatThrownBy(() -> joins.join(applicant, islandId,
                new JoinIslandCommandRequest("23456789"), key))
                .isInstanceOf(OutboxException.class);
    }

    @Test
    @DisplayName("이미 활성 멤버·만원·강퇴 이력·소속 상한·잠긴 방은 기존 코드로 거절된다")
    void joinRejectsMemberFullKickedLimitAndLockedIslands() {
        UUID applicant = newUser();
        UUID islandId = publicIsland("검증섬");

        // 만원
        UUID full = island("만원섬", false, 1, false);
        joinAs(newUser(), full, GroupMemberRole.OWNER);
        assertThatThrownBy(() -> joins.join(applicant, full, null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.ROOM_FULL);

        // 강퇴 이력
        joinAs(applicant, islandId, GroupMemberRole.MEMBER);
        jdbc.update("update group_members set is_left=true, left_reason='KICKED'"
                + " where group_id=? and user_id=?", islandId, applicant);
        assertThatThrownBy(() -> joins.join(applicant, islandId, null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.KICKED_CANNOT_REJOIN);

        // 이미 멤버
        UUID member = newUser();
        joinAs(member, islandId, GroupMemberRole.MEMBER);
        assertThatThrownBy(() -> joins.join(member, islandId, null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.ALREADY_MEMBER);

        // 소속 상한 10
        UUID loaded = newUser();
        for (int i = 0; i < 10; i++) {
            joinAs(loaded, publicIsland("상한섬" + i), GroupMemberRole.MEMBER);
        }
        assertThatThrownBy(() -> joins.join(loaded, publicIsland("열한번째"), null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.GROUP_LIMIT_EXCEEDED);

        // password 잠긴 기존 그룹 — IM-D04 미결 분기를 활성화하지 않는다
        UUID locked = island("잠긴섬", false, 10, false);
        jdbc.update("update groups set password='1234' where id=?", locked);
        assertThatThrownBy(() -> joins.join(newUser(), locked, null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.ISLAND_JOIN_UNAVAILABLE);
    }

    @Test
    @DisplayName("진행 중 집중 세션이 있으면 즉시 가입도 409 다 — 가입으로 이동 가드를 우회할 수 없다")
    void liveFocusSessionBlocksImmediateJoin() {
        UUID applicant = newUser();
        islands.create(applicant, new CreateIslandCommandRequest(
                "집중섬", null, false), UUID.randomUUID());
        UUID target = publicIsland("가입대상");
        legacyFocus.startFocusSession(applicant, new FocusSessionStartRequest(null, null));

        assertThatThrownBy(() -> joins.join(applicant, target, null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?",
                target, applicant)).isZero();
    }

    // ---------------------------------------------------------------- §3.7 승인 대기

    @Test
    @DisplayName("승인제 섬은 pending 요청만 만들고 신청자·방장에게 join.request.updated 를 남긴다")
    void approvalIslandCreatesPendingAndNotifiesApplicantAndHost() {
        UUID host = newUser();
        UUID applicant = newUser();
        UUID islandId = island("승인섬", false, 10, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);

        JoinIslandResultView result = joins.join(applicant, islandId, null, UUID.randomUUID());

        assertThat(result.status()).isEqualTo("pending");
        assertThat(result.requestId()).isNotNull();
        assertThat(result.currentIslandId()).isNull();
        assertThat(count("select count(*) from island_join_requests where id=?"
                + " and status='PENDING'", result.requestId())).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"
                + " and user_id=?", applicant)).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"
                + " and user_id=?", host)).isEqualTo(1);
        // pending 은 자리 예약이 아니다 — 멤버십도 현재 섬 이동도 만들지 않는다.
        assertThat(count("select count(*) from group_members where group_id=? and user_id=?",
                islandId, applicant)).isZero();
        assertThat(currentIsland(applicant)).isNull();

        JoinRequestStatusView status = joins.status(applicant, result.requestId());
        assertThat(status.status()).isEqualTo("pending");
        assertThat(status.islandId()).isEqualTo(islandId);
    }

    @Test
    @DisplayName("이미 열린 요청이 있으면 새 행이 아니라 같은 자원을 돌려주고 사건을 만들지 않는다")
    void joinAgainReturnsTheSamePendingResource() {
        UUID applicant = newUser();
        UUID islandId = island("승인섬", false, 10, true);
        joinAs(newUser(), islandId, GroupMemberRole.OWNER);

        JoinIslandResultView first = joins.join(applicant, islandId, null, UUID.randomUUID());
        long eventsBefore = count("select count(*) from event_outbox where type='join.request.updated'");
        JoinIslandResultView again = joins.join(applicant, islandId, null, UUID.randomUUID());

        assertThat(again.requestId()).isEqualTo(first.requestId());
        assertThat(again.status()).isEqualTo("pending");
        assertThat(count("select count(*) from island_join_requests where applicant_id=?",
                applicant)).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"))
                .as("조회/재시도에는 새 사건이 없다").isEqualTo(eventsBefore);
    }

    @Test
    @DisplayName("(섬, 신청자)의 PENDING 은 부분 유니크가 최후 방어선이다")
    void pendingPartialUniqueIndexIsTheLastDefense() {
        UUID applicant = newUser();
        UUID islandId = island("승인섬", false, 10, true);

        jdbc.update("insert into island_join_requests(id, island_id, applicant_id, status)"
                + " values(?,?,?,'PENDING')", UUID.randomUUID(), islandId, applicant);
        assertThatThrownBy(() -> jdbc.update(
                "insert into island_join_requests(id, island_id, applicant_id, status)"
                        + " values(?,?,?,'PENDING')", UUID.randomUUID(), islandId, applicant))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 닫힌 요청은 같은 쌍에 다시 만들 수 있다 — 재신청은 새 requestId 다.
        jdbc.update("insert into island_join_requests(id, island_id, applicant_id, status,"
                + " terminal_reason, resolved_at)"
                + " values(?,?,?,'CANCELLED','APPLICANT_CANCELLED',now())",
                UUID.randomUUID(), islandId, applicant);
    }

    // ---------------------------------------------------------------- §3.8 조회 · §3.9 취소

    @Test
    @DisplayName("타인의 requestId 는 「없음」이다 — 소유하지 않은 요청을 조회하면 404 다")
    void statusHidesRequestsOwnedBySomeoneElse() {
        UUID applicant = newUser();
        UUID stranger = newUser();
        UUID islandId = island("승인섬", false, 10, true);
        joinAs(newUser(), islandId, GroupMemberRole.OWNER);
        JoinIslandResultView pending = joins.join(applicant, islandId, null, UUID.randomUUID());

        assertThatThrownBy(() -> joins.status(stranger, pending.requestId()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.JOIN_REQUEST_NOT_FOUND);
        assertThatThrownBy(() -> joins.status(stranger, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.JOIN_REQUEST_NOT_FOUND);
    }

    @Test
    @DisplayName("취소는 PENDING 을 CANCELLED 로 원자 전이하고 신청자·방장에게 사건을 남긴다")
    void cancelTransitionsPendingToCancelledAndNotifies() {
        UUID host = newUser();
        UUID applicant = newUser();
        UUID islandId = island("승인섬", false, 10, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        JoinIslandResultView pending = joins.join(applicant, islandId, null, UUID.randomUUID());

        JoinRequestCancelView cancelled = joins.cancel(applicant, pending.requestId(), UUID.randomUUID());

        assertThat(cancelled.status()).isEqualTo("cancelled");
        assertThat(joins.status(applicant, pending.requestId()).status()).isEqualTo("cancelled");
        assertThat(count("select count(*) from island_join_requests where id=?"
                + " and status='CANCELLED' and terminal_reason='APPLICANT_CANCELLED'"
                + " and resolved_at is not null", pending.requestId())).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"
                + " and user_id=?", applicant)).isEqualTo(2);
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"
                + " and user_id=?", host)).isEqualTo(2);

        // 이미 닫힌 요청은 다시 닫을 수 없다 — 경합의 패자는 409 다.
        assertThatThrownBy(() -> joins.cancel(applicant, pending.requestId(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.JOIN_REQUEST_TERMINAL);
        // 그리고 남의 요청은 여전히 「없음」이다.
        assertThatThrownBy(() -> joins.cancel(newUser(), pending.requestId(), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.JOIN_REQUEST_NOT_FOUND);
    }

    @Test
    @DisplayName("같은 키의 취소 재시도는 원 응답을 재생하고 사건을 다시 만들지 않는다")
    void sameKeyCancelReplaysTheOriginalReceipt() {
        UUID applicant = newUser();
        UUID islandId = island("승인섬", false, 10, true);
        joinAs(newUser(), islandId, GroupMemberRole.OWNER);
        JoinIslandResultView pending = joins.join(applicant, islandId, null, UUID.randomUUID());
        UUID key = UUID.randomUUID();

        JoinRequestCancelView first = joins.cancel(applicant, pending.requestId(), key);
        long eventsBefore = count("select count(*) from event_outbox where type='join.request.updated'");
        JoinRequestCancelView replay = joins.cancel(applicant, pending.requestId(), key);

        assertThat(replay).isEqualTo(first);
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"))
                .isEqualTo(eventsBefore);
    }

    @Test
    @DisplayName("철회한 뒤 다시 신청하면 새 requestId 가 생긴다")
    void reapplyAfterCancelCreatesANewRequest() {
        UUID applicant = newUser();
        UUID islandId = island("승인섬", false, 10, true);
        joinAs(newUser(), islandId, GroupMemberRole.OWNER);
        JoinIslandResultView first = joins.join(applicant, islandId, null, UUID.randomUUID());
        joins.cancel(applicant, first.requestId(), UUID.randomUUID());

        JoinIslandResultView second = joins.join(applicant, islandId, null, UUID.randomUUID());

        assertThat(second.status()).isEqualTo("pending");
        assertThat(second.requestId()).isNotEqualTo(first.requestId());
        assertThat(joins.status(applicant, second.requestId()).status()).isEqualTo("pending");
    }

    // ---------------------------------------------------------------- §3.10 해석 · §3.11 발급

    @Test
    @DisplayName("발급은 발급자당 활성 코드 1개를 재사용하고 응답은 code·url·만료 없음이다")
    void issueReusesTheSingleActiveCodePerIssuer() {
        UUID issuer = newUser();
        UUID islandId = privateIsland("비공개섬");
        joinAs(issuer, islandId, GroupMemberRole.OWNER);

        IslandInvitationIssuedView first = invitations.issue(issuer, islandId, UUID.randomUUID());
        IslandInvitationIssuedView again = invitations.issue(issuer, islandId, UUID.randomUUID());

        assertThat(first.code()).hasSize(8);
        assertThat(first.url()).contains(first.code());
        assertThat(first.expiresAt()).as("TTL 은 두지 않는다").isNull();
        assertThat(again.code()).as("같은 발급자는 같은 코드를 돌려받는다").isEqualTo(first.code());
        assertThat(count("select count(*) from group_invite_links where group_id=? and inviter_id=?",
                islandId, issuer)).isEqualTo(1);

        // 비멤버는 발급할 수 없다.
        assertThatThrownBy(() -> invitations.issue(newUser(), islandId, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("해석은 공개 요약과 토큰을 돌려주고 형식 오류는 422·없는 코드는 404 다")
    void resolveReturnsSummaryAndTokenOrRejects() {
        UUID issuer = newUser();
        UUID resolver = newUser();
        UUID islandId = privateIsland("초대섬");
        joinAs(issuer, islandId, GroupMemberRole.OWNER);
        IslandInvitationIssuedView issued = invitations.issue(issuer, islandId, UUID.randomUUID());

        InvitationResolvedView resolved =
                invitations.resolve(resolver, new InvitationResolveCommandRequest(issued.code()));

        assertThat(resolved.island().id()).isEqualTo(islandId);
        assertThat(resolved.island().visibility()).isEqualTo("private");
        assertThat(resolved.island().membershipStatus()).isEqualTo("none");
        assertThat(resolved.island().joinRequestId()).isNull();
        assertThat(resolved.invitationToken()).isEqualTo(issued.code());

        assertThatThrownBy(() -> invitations.resolve(resolver,
                new InvitationResolveCommandRequest("hello!")))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.INVITATION_CODE_INVALID);
        assertThatThrownBy(() -> invitations.resolve(resolver,
                new InvitationResolveCommandRequest("zzzzzzzz")))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.SLUG_NOT_FOUND);
    }

    @Test
    @DisplayName("발급자 이탈·섬 종결은 코드를 영구 폐기로 만들고 세대가 바뀌면 재발급은 새 코드다")
    void issuerDepartureAndIslandEndRevokeTheCode() {
        UUID issuer = newUser();
        UUID resolver = newUser();
        UUID islandId = privateIsland("폐기섬");
        joinAs(issuer, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(issuer, islandId, UUID.randomUUID()).code();

        // 발급자가 떠나면 멤버십 세대가 올라 코드는 폐기다 — 해석도 가입 근거도 410.
        jdbc.update("update group_members set is_left=true, left_reason='LEFT',"
                + " membership_epoch=membership_epoch+1 where group_id=? and user_id=?",
                islandId, issuer);
        assertThatThrownBy(() -> invitations.resolve(resolver,
                new InvitationResolveCommandRequest(code)))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.INVITATION_EXPIRED);
        assertThatThrownBy(() -> joins.join(resolver, islandId,
                new JoinIslandCommandRequest(code), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.INVITATION_EXPIRED);

        // 섬 종결도 같은 폐기다.
        UUID island2 = privateIsland("종결섬");
        joinAs(issuer, island2, GroupMemberRole.OWNER);
        String code2 = invitations.issue(issuer, island2, UUID.randomUUID()).code();
        jdbc.update("update groups set status='ENDED' where id=?", island2);
        assertThatThrownBy(() -> invitations.resolve(resolver,
                new InvitationResolveCommandRequest(code2)))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.INVITATION_EXPIRED);

        // 재가입(새 세대) 뒤의 재발급은 새 코드 — 옛 코드는 「없음」이 된다.
        UUID island3 = privateIsland("세대섬");
        joinAs(issuer, island3, GroupMemberRole.OWNER);
        String code3 = invitations.issue(issuer, island3, UUID.randomUUID()).code();
        jdbc.update("update group_members set membership_epoch=membership_epoch+1"
                + " where group_id=? and user_id=?", island3, issuer);
        String code4 = invitations.issue(issuer, island3, UUID.randomUUID()).code();
        assertThat(code4).as("세대가 바뀐 뒤의 발급은 새 버전이다").isNotEqualTo(code3);
        assertThatThrownBy(() -> invitations.resolve(resolver,
                new InvitationResolveCommandRequest(code3)))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.SLUG_NOT_FOUND);
    }

    @Test
    @DisplayName("비공개 섬은 유효한 초대로만 들어오고, 잘못된 토큰은 무시되지 않고 410 이다")
    void privateIslandJoinsOnlyWithAValidInvitation() {
        UUID issuer = newUser();
        UUID applicant = newUser();
        UUID islandId = privateIsland("초대전용섬");
        joinAs(issuer, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(issuer, islandId, UUID.randomUUID()).code();

        // 초대 없이는 신청도 못 한다.
        assertThatThrownBy(() -> joins.join(applicant, islandId, null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.INVITATION_REQUIRED);

        // 다른 섬의 코드·없는 코드는 조용히 무시되지 않고 410 다.
        UUID otherIsland = privateIsland("다른섬");
        joinAs(issuer, otherIsland, GroupMemberRole.OWNER);
        String foreign = invitations.issue(issuer, otherIsland, UUID.randomUUID()).code();
        assertThatThrownBy(() -> joins.join(applicant, islandId,
                new JoinIslandCommandRequest(foreign), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.INVITATION_EXPIRED);
        assertThatThrownBy(() -> joins.join(applicant, islandId,
                new JoinIslandCommandRequest("zzzzzzzz"), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", InviteLinkErrorCode.INVITATION_EXPIRED);

        // 유효한 초대로는 들어오고 귀속이 기록된다.
        JoinIslandResultView joined = joins.join(applicant, islandId,
                new JoinIslandCommandRequest(code), UUID.randomUUID());
        assertThat(joined.status()).isEqualTo("active");
        assertThat(count("select count(*) from event_outbox where type='link.joined'"
                + " and user_id=?", applicant)).isEqualTo(1);
    }

    @Test
    @DisplayName("비공개 승인제 섬은 유효한 초대로 pending 을 만들고 초대 근거가 행에 남는다")
    void privateApprovalIslandKeepsInvitationEvidenceOnTheRequest() {
        UUID issuer = newUser();
        UUID applicant = newUser();
        UUID islandId = privateIsland("초대승인섬");
        jdbc.update("update groups set approval_required=true where id=?", islandId);
        joinAs(issuer, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(issuer, islandId, UUID.randomUUID()).code();

        JoinIslandResultView result = joins.join(applicant, islandId,
                new JoinIslandCommandRequest(code), UUID.randomUUID());

        assertThat(result.status()).isEqualTo("pending");
        UUID linkId = jdbc.queryForObject(
                "select invite_link_id from island_join_requests where id=?",
                UUID.class, result.requestId());
        assertThat(linkId).isEqualTo(
                inviteLinks.findBySlug(code).orElseThrow().getId());
    }

    @Test
    @DisplayName("섬이 종결되면 열린 신청은 ISLAND_CLOSED 로 닫히고 신청자에게 사건이 간다")
    void islandCloseTerminatesOpenRequests() {
        UUID host = newUser();
        UUID applicant = newUser();
        UUID islandId = island("종결승인섬", false, 10, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        JoinIslandResultView pending = joins.join(applicant, islandId, null, UUID.randomUUID());
        long applicantEvents = count("select count(*) from event_outbox"
                + " where type='join.request.updated' and user_id=?", applicant);

        memberService.withdrawGroup(islandId, host);

        assertThat(count("select count(*) from groups where id=? and status='ENDED'", islandId))
                .isEqualTo(1);
        assertThat(count("select count(*) from island_join_requests where id=?"
                + " and status='CANCELLED' and terminal_reason='ISLAND_CLOSED'"
                + " and resolved_at is not null", pending.requestId())).isEqualTo(1);
        assertThat(joins.status(applicant, pending.requestId()).status()).isEqualTo("cancelled");
        assertThat(count("select count(*) from event_outbox where type='join.request.updated'"
                + " and user_id=?", applicant)).isEqualTo(applicantEvents + 1);
    }

    // ---------------------------------------------------------------- 요약 연동 · HTTP 표면

    @Test
    @DisplayName("pending 을 가진 섬의 방문자 요약은 membershipStatus=pending 과 joinRequestId 를 준다")
    void pendingRequestShowsUpInTheVisitorSummary() {
        UUID applicant = newUser();
        UUID islandId = island("승인섬", false, 10, true);
        joinAs(newUser(), islandId, GroupMemberRole.OWNER);
        JoinIslandResultView pending = joins.join(applicant, islandId, null, UUID.randomUUID());

        IslandViewResponse view = islands.view(islandId, applicant);

        assertThat(view.scope()).isEqualTo("visitor");
        assertThat(view.visitor().membershipStatus()).isEqualTo("pending");
        assertThat(view.visitor().joinRequestId()).isEqualTo(pending.requestId());
    }

    @Test
    @DisplayName("내부 HTTP 표면 — 가입과 해석이 allowlist 를 통과해 같은 계약으로 응답한다")
    void httpSurfaceJoinsAndResolves() throws Exception {
        UUID issuer = newUser();
        UUID applicant = newUser();
        UUID islandId = privateIsland("HTTP섬");
        joinAs(issuer, islandId, GroupMemberRole.OWNER);
        String code = invitations.issue(issuer, islandId, UUID.randomUUID()).code();

        mvc.perform(post("/internal/users/" + applicant + "/invitations/resolve")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", applicant.toString())
                        .contentType("application/json")
                        .content("{\"code\":\"" + code + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.island.id").value(islandId.toString()))
                .andExpect(jsonPath("$.invitationToken").value(code));

        mvc.perform(post("/internal/users/" + applicant + "/islands/" + islandId + "/memberships")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", applicant.toString())
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content("{\"invitationToken\":\"" + code + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active"))
                .andExpect(jsonPath("$.currentIslandId").value(islandId.toString()))
                .andExpect(jsonPath("$.requestId").doesNotExist());

        // 형식 오류는 422 + 코드 문자열 계약이다.
        mvc.perform(post("/internal/users/" + applicant + "/invitations/resolve")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", applicant.toString())
                        .contentType("application/json")
                        .content("{\"code\":\"!!!\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVITATION_CODE_INVALID"));
    }

    // ---------------------------------------------------------------- 도구

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private UUID publicIsland(String name) {
        return island(name, false, 10, false);
    }

    private UUID privateIsland(String name) {
        return island(name, true, 10, false);
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

    /** 컨텍스트 행 자체가 없을 수 있다 — 그 «없음» 도 null 로 읽는다. */
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

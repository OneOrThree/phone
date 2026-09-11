package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupLeaveReason;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.InOrder;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * GroupMemberService 단위 테스트.
 *
 * <p>대상: 방장 권한 이양(transferOwner), 그룹 탈퇴(withdrawGroup),
 * 계정 탈퇴자 분리(detachWithdrawnUser — GROMO-1656 에서 UserService 로부터 옮겨 왔다).
 * 핵심 검증 포인트는 OWNER 권한, 멤버십 존재,
 * 그리고 탈퇴 시 멤버 수에 따른 분기(마지막 1명→그룹 close, OWNER 다수→차단, 일반멤버→삭제).
 */
@ExtendWith(MockitoExtension.class)
class GroupMemberServiceTest {

    /**
     * 링크 대상 내구 명령 (GROMO-1660 · A22 ⓑ·ⓑ′·㋢·㋡) — 이 클래스의 단언은 코어 상태라
     * 봉투 기록은 목으로 둔다. 「실제로 적히는가」는 실물 DB 위의 통합 테스트가 본다.
     */
    @Mock
    private GroupMembershipMutationLocks membershipLocks;

    @Mock
    private IslandMembershipEvents membershipEvents;

    @Mock
    private com.oneorthree.phone.group.service.LinkMembershipEventService linkMembershipEventService;

    @InjectMocks
    private GroupMemberService groupMemberService;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupQueryService groupQueryService;

    @Mock
    private UserQueryService userQueryService;

    @Mock
    private GroupBetService groupBetService;

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID OWNER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID TARGET_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    // ── transferOwner ─────────────────────────────────────────────────────

    @Test
    @DisplayName("권한 이양 성공 → 기존 방장 강등 + 대상 승격")
    void transferOwnerSuccess() {
        // given: OWNER_ID 가 OWNER, TARGET_ID 가 일반 멤버인 그룹
        User owner = User.builder().id(OWNER_ID).build();
        User target = User.builder().id(TARGET_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember hostMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build();
        GroupMember targetMember = GroupMember.builder()
                .user(target).group(group).role(GroupMemberRole.MEMBER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(userQueryService.getTargetForShare(TARGET_ID)).willReturn(target);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(owner, group)).willReturn(Optional.of(hostMember));
        given(groupQueryService.findMembership(target, group)).willReturn(Optional.of(targetMember));

        // when
        groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID);

        // then: 역할 교체 (GROMO-676 — groups.host_id 폐기, role 이 방장의 단일 원천)
        assertThat(hostMember.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(targetMember.getRole()).isEqualTo(GroupMemberRole.OWNER);
        // 요청자·대상 모두 공유 락 로드여야 한다 (GROMO-801·1227) — 락 없는 findById 면 계정 탈퇴와
        // 직렬화되지 않아, 탈퇴한 유저가 오너로 되살아나는 레이스가 열린다.
        verify(userQueryService).getCallerForShare(OWNER_ID);
        verify(userQueryService).getTargetForShare(TARGET_ID);
        verify(userQueryService, never()).getCaller(any(UUID.class));
        verify(userQueryService, never()).getTarget(any(UUID.class));
    }

    @Test
    @DisplayName("위임 대상이 이미 탈퇴한 유저 → UserException(NOT_FOUND), 역할 변경 없음 (GROMO-801)")
    void transferOwnerRejectsWithdrawnTarget() {
        User owner = User.builder().id(OWNER_ID).build();
        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        // 탈퇴가 먼저 커밋된 대상 — 활성 조회(공유 락)가 빈 결과를 돌려준다
        given(userQueryService.getTargetForShare(TARGET_ID)).willThrow(new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));

        // GROMO-1247: 여기는 대상 유저다 — 요청자 세션 사망 코드(USER_NOT_FOUND)로 새면 앱이
        // 멀쩡한 방장을 로그아웃시킨다. 대상 부재는 기존 NOT_FOUND 그대로 유지한다.
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.TARGET_USER_NOT_FOUND)
                .isNotEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("게스트 요청자도 신원 가드에 걸리지 않는다 — 그룹 조회까지 진행 후 NOT_FOUND (GROMO-1509)")
    void transferOwnerAllowsGuest() {
        // given: 요청자가 게스트, 그룹은 없음 — 가드가 남아 있으면 GUEST_FORBIDDEN 으로 먼저 튕겨 실패한다
        User owner = User.builder().id(OWNER_ID).isGuest(true).build();
        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(userQueryService.getTargetForShare(TARGET_ID))
                .willReturn(User.builder().id(TARGET_ID).build());
        given(groupQueryService.getGroup(GROUP_ID))
                .willThrow(new GroupException(GroupErrorCode.GROUP_NOT_FOUND));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GROUP_NOT_FOUND);
    }

    @Test
    @DisplayName("요청자 유저 없음·탈퇴 선커밋 → UserException(USER_NOT_FOUND), 역할 변경 없음 (GROMO-1227·1247)")
    void transferOwnerUserNotFound() {
        // given: 없는 유저와 탈퇴 선커밋 유저는 공유 락 조회에서 똑같이 빈 결과다
        given(userQueryService.getCallerForShare(OWNER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        // when & then: 부작용 없이 거절 — 멤버십 로드조차 하지 않는다
        // GROMO-1247: 요청자 세션 사망은 USER_NOT_FOUND — 대상 유저 부재(NOT_FOUND)와 다른 코드다.
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
        verify(groupQueryService, never()).findMembership(any(), any());
        verify(groupQueryService, never()).getMembership(any(), any());
    }

    @Test
    @DisplayName("그룹 없음 → GroupException(NOT_FOUND)")
    void transferOwnerGroupNotFound() {
        // given: 요청자/대상 유저는 존재하지만 그룹 없음
        User owner = User.builder().id(OWNER_ID).build();
        User target = User.builder().id(TARGET_ID).build();
        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(userQueryService.getTargetForShare(TARGET_ID)).willReturn(target);
        given(groupQueryService.getGroup(GROUP_ID))
                .willThrow(new GroupException(GroupErrorCode.GROUP_NOT_FOUND));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GROUP_NOT_FOUND);
    }

    @Test
    @DisplayName("요청자가 OWNER 아님 → GroupException(NOT_OWNER)")
    void transferOwnerNotOwner() {
        // given: 요청자의 GroupMember role 이 OWNER 가 아님 → filter 에서 탈락
        User owner = User.builder().id(OWNER_ID).build();
        User target = User.builder().id(TARGET_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember hostMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.MEMBER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(userQueryService.getTargetForShare(TARGET_ID)).willReturn(target);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(owner, group)).willReturn(Optional.of(hostMember));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_OWNER);
    }

    @Test
    @DisplayName("대상이 그룹 멤버 아님 → GroupException(NOT_FOUND)")
    void transferOwnerTargetNotMember() {
        // given: 요청자는 OWNER 지만 대상의 멤버십이 없음
        User owner = User.builder().id(OWNER_ID).build();
        User target = User.builder().id(TARGET_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember hostMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(userQueryService.getTargetForShare(TARGET_ID)).willReturn(target);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(owner, group)).willReturn(Optional.of(hostMember));
        given(groupQueryService.findMembership(target, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    // ── kickMember (A-3) ──────────────────────────────────────────────────

    @Test
    @DisplayName("강퇴 성공 → 대상 이탈 마킹(KICKED), 행 삭제 없음")
    void kickMemberSuccess() {
        // given: OWNER 가 일반 멤버(TARGET)를 강퇴
        User owner = User.builder().id(OWNER_ID).build();
        User target = User.builder().id(TARGET_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember ownerMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build();
        GroupMember targetMember = GroupMember.builder()
                .user(target).group(group).role(GroupMemberRole.MEMBER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(userQueryService.getTargetForShare(TARGET_ID)).willReturn(target);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupQueryService.findMembership(target, group)).willReturn(Optional.of(targetMember));

        // when
        groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID);

        // then: 강퇴 마킹(재참여 차단), 행 삭제 없음
        assertThat(targetMember.isLeft()).isTrue();
        assertThat(targetMember.isKicked()).isTrue();
        assertThat(targetMember.getLeftReason()).isEqualTo(GroupLeaveReason.KICKED);
        verify(groupMemberRepository, never()).delete(any());
        // 요청자·대상 모두 공유 락 로드여야 한다 (GROMO-1227) — 락 없는 findById 면 대상의 계정
        // 탈퇴와 직렬화되지 않아, kick() 의 full-row UPDATE 가 탈퇴의 leave 를 되덮는다(lost update).
        verify(userQueryService).getCallerForShare(OWNER_ID);
        verify(userQueryService).getTargetForShare(TARGET_ID);
        verify(userQueryService, never()).getCaller(any(UUID.class));
        verify(userQueryService, never()).getTarget(any(UUID.class));
    }

    @Test
    @DisplayName("강퇴 요청자의 탈퇴 선커밋 → UserException(USER_NOT_FOUND), 부작용 없음 (GROMO-1227·1247)")
    void kickRejectsWithdrawnRequester() {
        given(userQueryService.getCallerForShare(OWNER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
        verify(userActivityEventLogger, never()).log(any(), any());
    }

    @Test
    @DisplayName("강퇴 대상의 탈퇴 선커밋 → UserException(NOT_FOUND), 강퇴 마킹 없음 (GROMO-1227)")
    void kickRejectsWithdrawnTarget() {
        // given: 요청자는 정상 OWNER, 대상은 탈퇴가 먼저 커밋됨 — 공유 락 조회가 빈 결과
        User owner = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember ownerMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(owner, group)).willReturn(Optional.of(ownerMember));
        given(userQueryService.getTargetForShare(TARGET_ID)).willThrow(new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));

        // when & then: 거절 + 이탈 이벤트 없음
        // GROMO-1247: 대상 유저 부재라 NOT_FOUND 유지 — transferOwner 대상과 같은 논증이다.
        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.TARGET_USER_NOT_FOUND)
                .isNotEqualTo(UserErrorCode.USER_NOT_FOUND);
        verify(userActivityEventLogger, never()).log(any(), any());
    }

    @Test
    @DisplayName("본인 강퇴 시도 → GroupException(CANNOT_KICK_SELF)")
    void kickSelfRejected() {
        // given: OWNER 가 자기 자신을 대상으로 강퇴
        User owner = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember ownerMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(owner, group)).willReturn(Optional.of(ownerMember));

        // when & then
        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, OWNER_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.CANNOT_KICK_SELF);
    }

    @Test
    @DisplayName("요청자가 OWNER 아님 → GroupException(NOT_OWNER)")
    void kickNotOwner() {
        // given: 요청자가 일반 멤버
        User user = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember member = GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.MEMBER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(user);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(user, group)).willReturn(Optional.of(member));

        // when & then
        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_OWNER);
    }

    @Test
    @DisplayName("대상이 그룹 멤버 아님 → GroupException(NOT_FOUND)")
    void kickTargetNotMember() {
        // given: 요청자는 OWNER 지만 대상의 활성 멤버십이 없음
        User owner = User.builder().id(OWNER_ID).build();
        User target = User.builder().id(TARGET_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember ownerMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(owner);
        given(userQueryService.getTargetForShare(TARGET_ID)).willReturn(target);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.findMembership(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupQueryService.findMembership(target, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("게스트 요청자도 신원 가드에 걸리지 않는다 — 그룹 조회까지 진행 후 NOT_FOUND (GROMO-1509)")
    void kickAllowsGuest() {
        // given: 요청자가 게스트, 그룹은 없음 — 가드가 남아 있으면 GUEST_FORBIDDEN 으로 먼저 튕겨 실패한다
        User guest = User.builder().id(OWNER_ID).isGuest(true).build();
        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(guest);
        given(groupQueryService.getGroup(GROUP_ID))
                .willThrow(new GroupException(GroupErrorCode.GROUP_NOT_FOUND));

        // when & then
        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GROUP_NOT_FOUND);
    }

    // ── withdrawGroup ─────────────────────────────────────────────────────

    @Test
    @DisplayName("마지막 멤버 탈퇴 → 이탈 마킹(leave) + group.close() (A-0 소프트삭제)")
    void withdrawLastMember() {
        // given: 멤버가 본인 1명뿐
        User user = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember member = GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.OWNER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(user);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.getMembership(user, group)).willReturn(member);
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member));

        // when
        groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID);

        // then: 행 삭제 없이 이탈 마킹(LEFT) + 그룹 종료. OPEN 내기 정리(환불·자동 취소)도 같은 트랜잭션에서.
        verify(groupMemberRepository, never()).delete(any());
        assertThat(member.isLeft()).isTrue();
        assertThat(member.getLeftReason()).isEqualTo(GroupLeaveReason.LEFT);
        assertThat(group.getStatus()).isEqualTo(GroupStatus.ENDED);
        verify(groupBetService).releaseFromOpenBets(user, group);
    }

    @Test
    @DisplayName("일반 멤버 탈퇴 → 이탈 마킹(그룹 유지) (A-0 소프트삭제)")
    void withdrawNormalMember() {
        // given: 멤버 다수, 본인 role == MEMBER
        User user = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember member = GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.MEMBER).build();
        GroupMember other = GroupMember.builder()
                .group(group).role(GroupMemberRole.OWNER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(user);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.getMembership(user, group)).willReturn(member);
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member, other));

        // when
        groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID);

        // then: 행 삭제 없이 이탈 마킹(LEFT), 그룹은 종료되지 않음. OPEN 내기 정리 훅도 호출된다.
        verify(groupMemberRepository, never()).delete(any());
        assertThat(member.isLeft()).isTrue();
        assertThat(member.getLeftReason()).isEqualTo(GroupLeaveReason.LEFT);
        assertThat(group.getStatus()).isNotEqualTo(GroupStatus.ENDED);
        verify(groupBetService).releaseFromOpenBets(user, group);
        // 요청자는 공유 락 로드여야 한다 (GROMO-1227) — releaseFromOpenBets(환불·돈 경로)에
        // 들어가는 User 가 락 없는 stale 스냅샷이면 계정 탈퇴의 내기 정리(#503)를 옆문으로 우회한다.
        verify(userQueryService).getCallerForShare(OWNER_ID);
        verify(userQueryService, never()).getCaller(any(UUID.class));
        verify(userQueryService, never()).getTarget(any(UUID.class));
    }

    @Test
    @DisplayName("그룹 탈퇴 요청자의 계정 탈퇴 선커밋 → UserException(USER_NOT_FOUND), 내기 정리 미호출 (GROMO-1227·1247)")
    void withdrawRejectsWithdrawnUser() {
        // given: 계정 탈퇴가 먼저 커밋된 유저 — 공유 락 조회가 빈 결과
        given(userQueryService.getCallerForShare(OWNER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        // when & then: 환불 경로(releaseFromOpenBets)가 시작되면 안 된다
        assertThatThrownBy(() -> groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
        verify(groupBetService, never()).releaseFromOpenBets(any(), any());
    }

    @Test
    @DisplayName("게스트 요청자도 신원 가드에 걸리지 않는다 — 그룹 조회까지 진행 후 NOT_FOUND (GROMO-1509)")
    void withdrawAllowsGuest() {
        // given: 요청자가 게스트, 그룹은 없음 — 가드가 남아 있으면 GUEST_FORBIDDEN 으로 먼저 튕겨 실패한다
        User user = User.builder().id(OWNER_ID).isGuest(true).build();
        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(user);
        given(groupQueryService.getGroup(GROUP_ID))
                .willThrow(new GroupException(GroupErrorCode.GROUP_NOT_FOUND));

        // when & then
        assertThatThrownBy(() -> groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GROUP_NOT_FOUND);
    }

    @Test
    @DisplayName("멤버가 아님 → GroupException(MEMBER_ONLY)")
    void withdrawNotMember() {
        // given: 유저/그룹은 있지만 멤버십 없음
        User user = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(user);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.getMembership(user, group))
                .willThrow(new GroupException(GroupErrorCode.MEMBER_ONLY));

        // when & then
        assertThatThrownBy(() -> groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("멤버 다수인데 OWNER 가 탈퇴 시도 → GroupException(HOST_WITHDRAW)")
    void withdrawOwnerWithOthers() {
        // given: 멤버 다수, 본인 role == OWNER
        User user = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember member = GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.OWNER).build();
        GroupMember other = GroupMember.builder()
                .group(group).role(GroupMemberRole.MEMBER).build();

        given(userQueryService.getCallerForShare(OWNER_ID)).willReturn(user);
        given(groupQueryService.getGroup(GROUP_ID)).willReturn(group);
        given(groupQueryService.getMembership(user, group)).willReturn(member);
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member, other));

        // when & then: 예외 발생 + 삭제 미호출. 내기 정리도 시작되면 안 된다(탈퇴 자체가 거절).
        assertThatThrownBy(() -> groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.HOST_WITHDRAW);
        verify(groupMemberRepository, never()).delete(member);
        verify(groupBetService, never()).releaseFromOpenBets(user, group);
    }
    // ── detachWithdrawnUser (계정 탈퇴자 분리, GROMO-1656 이전) ─────────────

    private static final UUID WITHDRAWER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000f1");

    @Test
    @DisplayName("혼자 있는 소유 그룹은 자동 종료(ENDED)되고 방장 멤버십도 이탈 처리된다 (A-2)")
    void detachAutoEndsSoloOwnedGroup() {
        User user = User.builder().id(WITHDRAWER_ID).build();
        Group soloGroup = Group.builder().id(UUID.fromString("00000000-0000-0000-0000-0000000000aa"))
                .status(GroupStatus.WAITING).build();
        GroupMember ownerMembership = GroupMember.builder()
                .user(user).group(soloGroup).role(GroupMemberRole.OWNER).build();
        given(groupMemberRepository.findActiveOwnerMembershipsByUserId(WITHDRAWER_ID))
                .willReturn(List.of(ownerMembership));
        // 활성 멤버가 방장 1명뿐 → 위임할 상대가 없으므로 자동 종료 대상
        given(groupMemberRepository.findByGroup(soloGroup)).willReturn(List.of(ownerMembership));
        given(groupRepository.existsGroupOwnedBy(WITHDRAWER_ID)).willReturn(false);

        groupMemberService.detachWithdrawnUser(user);

        assertThat(soloGroup.getStatus()).isEqualTo(GroupStatus.ENDED);
        assertThat(ownerMembership.isLeft()).isTrue();
        // 자동 종료된 그룹이라도 OPEN 내기 판돈이 묶이면 안 된다 — 유저 스코프 일괄 해제는
        // 멤버십·그룹 상태와 무관하게 반드시 불린다
        verify(groupBetService).releaseFromAllOpenBets(user);
    }

    @Test
    @DisplayName("MEMBER 멤버십은 전부 leave — 안 하면 nickname null 유령이 정원을 차지한다")
    void detachLeavesEveryActiveMembership() {
        User user = User.builder().id(WITHDRAWER_ID).build();
        Group groupA = Group.builder().id(UUID.fromString("00000000-0000-0000-0000-0000000000a1"))
                .status(GroupStatus.WAITING).build();
        Group groupB = Group.builder().id(UUID.fromString("00000000-0000-0000-0000-0000000000a2"))
                .status(GroupStatus.WAITING).build();
        GroupMember membershipA = GroupMember.builder()
                .user(user).group(groupA).role(GroupMemberRole.MEMBER).build();
        GroupMember membershipB = GroupMember.builder()
                .user(user).group(groupB).role(GroupMemberRole.MEMBER).build();
        given(groupRepository.existsGroupOwnedBy(WITHDRAWER_ID)).willReturn(false);
        given(groupMemberRepository.findByUser(user)).willReturn(List.of(membershipA, membershipB));

        groupMemberService.detachWithdrawnUser(user);

        assertThat(membershipA.isLeft()).isTrue();
        assertThat(membershipB.isLeft()).isTrue();
    }

    @Test
    @DisplayName("내기 해제 → 판정 근거 박제 순서다 — 뒤집으면 이미 해제된 행까지 박제한다")
    void detachFreezesEvidenceAfterReleasing() {
        User user = User.builder().id(WITHDRAWER_ID).build();
        given(groupRepository.existsGroupOwnedBy(WITHDRAWER_ID)).willReturn(false);

        groupMemberService.detachWithdrawnUser(user);

        InOrder order = inOrder(groupBetService);
        order.verify(groupBetService).releaseFromAllOpenBets(user);
        order.verify(groupBetService).freezeEvidenceForAccountErasure(user);
    }

    @Test
    @DisplayName("위임 안 한 방장 그룹이 남으면 HOST_WITHDRAW — 돈이 움직이기 전에 막는다")
    void detachRejectsUndelegatedHostBeforeAnyMoneyMoves() {
        User user = User.builder().id(WITHDRAWER_ID).build();
        given(groupRepository.existsGroupOwnedBy(WITHDRAWER_ID)).willReturn(true);

        assertThatThrownBy(() -> groupMemberService.detachWithdrawnUser(user))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.HOST_WITHDRAW);

        // 판정이 해제·박제·이탈보다 앞이라 아무것도 시작되지 않는다
        verify(groupBetService, never()).releaseFromAllOpenBets(any());
        verify(groupBetService, never()).freezeEvidenceForAccountErasure(any());
        verify(groupMemberRepository, never()).findByUser(any());
    }
}

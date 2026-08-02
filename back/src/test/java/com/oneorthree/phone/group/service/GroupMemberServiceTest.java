package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupLeaveReason;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * GroupMemberService 단위 테스트.
 *
 * <p>대상: 방장 권한 이양(transferOwner), 그룹 탈퇴(withdrawGroup).
 * 핵심 검증 포인트는 게스트 차단, OWNER 권한, 멤버십 존재,
 * 그리고 탈퇴 시 멤버 수에 따른 분기(마지막 1명→그룹 close, OWNER 다수→차단, 일반멤버→삭제).
 */
@ExtendWith(MockitoExtension.class)
class GroupMemberServiceTest {

    @InjectMocks
    private GroupMemberService groupMemberService;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private UserRepository userRepository;

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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(hostMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.of(targetMember));

        // when
        groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID);

        // then: 역할 교체 (GROMO-676 — groups.host_id 폐기, role 이 방장의 단일 원천)
        assertThat(hostMember.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(targetMember.getRole()).isEqualTo(GroupMemberRole.OWNER);
    }

    @Test
    @DisplayName("게스트 유저 → GroupException(GUEST_FORBIDDEN)")
    void transferOwnerGuestForbidden() {
        // given: 요청자가 게스트
        User owner = User.builder().id(OWNER_ID).isGuest(true).build();
        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GUEST_FORBIDDEN);
    }

    @Test
    @DisplayName("요청자 유저 없음 → UserException(NOT_FOUND)")
    void transferOwnerUserNotFound() {
        // given
        given(userRepository.findById(OWNER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("그룹 없음 → GroupException(NOT_FOUND)")
    void transferOwnerGroupNotFound() {
        // given: 요청자/대상 유저는 존재하지만 그룹 없음
        User owner = User.builder().id(OWNER_ID).build();
        User target = User.builder().id(TARGET_ID).build();
        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(hostMember));

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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(hostMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.empty());

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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.of(targetMember));

        // when
        groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID);

        // then: 강퇴 마킹(재참여 차단), 행 삭제 없음
        assertThat(targetMember.isLeft()).isTrue();
        assertThat(targetMember.isKicked()).isTrue();
        assertThat(targetMember.getLeftReason()).isEqualTo(GroupLeaveReason.KICKED);
        verify(groupMemberRepository, never()).delete(any());
    }

    @Test
    @DisplayName("본인 강퇴 시도 → GroupException(CANNOT_KICK_SELF)")
    void kickSelfRejected() {
        // given: OWNER 가 자기 자신을 대상으로 강퇴
        User owner = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupMember ownerMember = GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));

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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));

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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("게스트 요청자 → GroupException(GUEST_FORBIDDEN)")
    void kickGuestForbidden() {
        // given: 요청자가 게스트
        User guest = User.builder().id(OWNER_ID).isGuest(true).build();
        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupMemberService.kickMember(GROUP_ID, TARGET_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GUEST_FORBIDDEN);
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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member, other));

        // when
        groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID);

        // then: 행 삭제 없이 이탈 마킹(LEFT), 그룹은 종료되지 않음. OPEN 내기 정리 훅도 호출된다.
        verify(groupMemberRepository, never()).delete(any());
        assertThat(member.isLeft()).isTrue();
        assertThat(member.getLeftReason()).isEqualTo(GroupLeaveReason.LEFT);
        assertThat(group.getStatus()).isNotEqualTo(GroupStatus.ENDED);
        verify(groupBetService).releaseFromOpenBets(user, group);
    }

    @Test
    @DisplayName("게스트 유저 → GroupException(GUEST_FORBIDDEN)")
    void withdrawGuestForbidden() {
        // given: 요청자가 게스트
        User user = User.builder().id(OWNER_ID).isGuest(true).build();
        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(user));

        // when & then
        assertThatThrownBy(() -> groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GUEST_FORBIDDEN);
    }

    @Test
    @DisplayName("멤버가 아님 → GroupException(MEMBER_ONLY)")
    void withdrawNotMember() {
        // given: 유저/그룹은 있지만 멤버십 없음
        User user = User.builder().id(OWNER_ID).build();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

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

        given(userRepository.findById(OWNER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member, other));

        // when & then: 예외 발생 + 삭제 미호출. 내기 정리도 시작되면 안 된다(탈퇴 자체가 거절).
        assertThatThrownBy(() -> groupMemberService.withdrawGroup(GROUP_ID, OWNER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.HOST_WITHDRAW);
        verify(groupMemberRepository, never()).delete(member);
        verify(groupBetService, never()).releaseFromOpenBets(user, group);
    }
}

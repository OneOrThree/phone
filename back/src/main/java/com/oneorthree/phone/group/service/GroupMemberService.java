package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupMemberService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final GroupBetService groupBetService;

    @Transactional
    public void transferOwner(UUID groupId, UUID targetUserId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        User targetUser = userRepository.findById(targetUserId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember hostGroupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .filter(m -> m.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));

        GroupMember targetGroupMember = groupMemberRepository.findByUserAndGroup(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // GROMO-676: groups.host_id 폐기 — 방장 이양은 group_members.role 교체(OWNER↔MEMBER)로만 수행한다.
        hostGroupMember.demoteToMember();
        targetGroupMember.promoteToOwner();
    }

    /** 멤버 강퇴 (A-3) — OWNER 전용. 소프트삭제 + KICKED 마커로 재참여를 막는다. 본인은 강퇴 불가. */
    @Transactional
    public void kickMember(UUID groupId, UUID targetUserId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 요청자는 활성 OWNER 여야 한다
        groupMemberRepository.findByUserAndGroup(user, group)
                .filter(m -> m.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));

        // 본인 강퇴 불가 — 방장은 위임 후 탈퇴, 멤버는 나가기를 쓴다
        if (userId.equals(targetUserId)) {
            throw new GroupException(GroupErrorCode.CANNOT_KICK_SELF);
        }

        User targetUser = userRepository.findById(targetUserId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        GroupMember target = groupMemberRepository.findByUserAndGroup(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 강퇴 마킹. 진행 중 내기 판돈은 건드리지 않는다(지갑 생존 → 정산 시 정상 지급/환불, 엔진 무변경).
        target.kick();
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
    }

    @Transactional
    public void withdrawGroup(UUID groupId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        // A-0 소프트삭제: 행을 지우지 않고 이탈 마킹(leave). findByGroup 은 활성만 세므로 마지막 1인 판정 유지.
        List<GroupMember> groupMembers = groupMemberRepository.findByGroup(group);
        if (groupMembers.size() > 1 && groupMember.getRole() == GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        }

        // 탈퇴가 확정된 뒤, 같은 트랜잭션에서 OPEN 내기부터 정리한다(참가 해제·환불·자동 취소).
        // 별도 트랜잭션이면 "탈퇴는 됐는데 판돈은 묶인" 반쪽 상태가 생길 수 있다.
        groupBetService.releaseFromOpenBets(user, group);

        if (groupMembers.size() == 1) {
            groupMember.leave();
            group.close();
        } else if (groupMember.getRole() == GroupMemberRole.MEMBER) {
            groupMember.leave();
        }
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
    }
}

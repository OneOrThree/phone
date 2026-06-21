package com.oneorthree.phone.group.service;

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
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupMemberService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;

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

        hostGroupMember.demoteToMember();
        targetGroupMember.promoteToOwner();
        group.transferOwner(targetUserId);
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

        List<GroupMember> groupMembers = groupMemberRepository.findByGroup(group);
        if (groupMembers.size() == 1) {
            groupMemberRepository.delete(groupMember);
            group.close();
        } else if (groupMembers.size() > 1 && groupMember.getRole() == GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        } else if (groupMember.getRole() == GroupMemberRole.MEMBER) {
            groupMemberRepository.delete(groupMember);
        }
    }
}

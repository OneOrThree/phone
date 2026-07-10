package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupAnnouncement;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.dto.GroupAnnouncementResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
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
public class GroupAnnouncementService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final GroupAnnouncementRepository groupAnnouncementRepository;

    @Transactional
    public void createAnnouncement(UUID groupId, UUID userId, CreateAnnouncementRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        // GROMO-676: 방장은 항상 가능, 멤버는 announcement_permission=ALLOW 일 때 가능
        if (!groupMember.canWriteAnnouncement()) {
            throw new GroupException(GroupErrorCode.NOTICE_FORBIDDEN);
        }

        groupAnnouncementRepository.save(
                GroupAnnouncement.builder()
                        .group(group)
                        .user(user)
                        .title(request.getTitle())
                        .content(request.getContent())
                        .build()
        );
    }

    public List<GroupAnnouncementResponse> getAnnouncements(UUID groupId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        return groupAnnouncementRepository.findByGroupOrderByCreatedAtDesc(group)
                .stream()
                .map(a -> GroupAnnouncementResponse.builder()
                        .id(a.getId())
                        .title(a.getTitle())
                        .content(a.getContent())
                        .createdAt(a.getCreatedAt())
                        .build())
                .toList();
    }

    @Transactional
    public void updateAnnouncement(UUID groupId, UUID announcementId, UUID userId, CreateAnnouncementRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember member = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        if (!member.canWriteAnnouncement()) {
            throw new GroupException(GroupErrorCode.NOTICE_FORBIDDEN);
        }

        GroupAnnouncement announcement = groupAnnouncementRepository.findByIdAndGroup(announcementId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        announcement.updateContent(request.getTitle(), request.getContent());
    }

    @Transactional
    public void deleteAnnouncement(UUID groupId, UUID announcementId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember member = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        if (!member.canWriteAnnouncement()) {
            throw new GroupException(GroupErrorCode.NOTICE_FORBIDDEN);
        }

        GroupAnnouncement announcement = groupAnnouncementRepository.findByIdAndGroup(announcementId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        groupAnnouncementRepository.delete(announcement);
    }
}

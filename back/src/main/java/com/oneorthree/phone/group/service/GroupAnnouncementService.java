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
        User user = requireActiveUser(userId);

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
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
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
        User user = requireActiveUser(userId);

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
        User user = requireActiveUser(userId);

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

    /**
     * 활성 검증 + 공유 락 + 게스트 차단 (GROMO-801 락 규율, GROMO-1237) — 공지 생성·수정·삭제처럼
     * users 행은 <b>읽기만 하고</b> 그룹 자원을 변경하는 트랜잭션의 요청자 로드. 락 없는 findById 는
     * 계정 탈퇴(UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아 탈퇴의 정리 스캔 이후·커밋
     * 이전에 낀 변경이 유령(탈퇴자 명의 공지)으로 남는다. 수정·삭제는 작성이 아닌 권한 행사지만,
     * is_deleted 필터로 탈퇴자 토큰의 그룹 상태 변경을 차단하고 finder 를 통일하는 목적으로 같은
     * 경로를 태운다. 탈퇴가 먼저 커밋되면 READ COMMITTED 재평가로 빈 결과 → NOT_FOUND(404).
     * 게스트는 기존 가드 그대로 GUEST_FORBIDDEN(403).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        User user = userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }
}

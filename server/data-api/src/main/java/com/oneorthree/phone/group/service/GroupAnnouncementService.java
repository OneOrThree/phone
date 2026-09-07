package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.dto.GroupAnnouncementResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * 그룹 공지 CRUD. 클래스 기본 트랜잭션은 읽기 전용이고 변경 메서드만 쓰기 트랜잭션을 연다.
 *
 * <p>네 메서드가 같은 관문을 지난다 — 요청자 활성 검증 → 그룹 존재 → 멤버십 → 작성 권한.
 * 권한은 방장이거나 {@code announcement_permission=ALLOW} 인 멤버이고, <b>수정·삭제도 작성자
 * 본인 여부를 보지 않는다</b>: 권한만 있으면 남의 공지도 손댈 수 있다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupAnnouncementService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserQueryService userQueryService;
    private final GroupAnnouncementRepository groupAnnouncementRepository;

    /**
     * 공지를 새로 남긴다. 작성자는 요청자로 고정이라 대리 작성이 불가능하다.
     *
     * <p>비멤버는 {@code MEMBER_ONLY}, 가입은 했지만 권한이 없으면 {@code NOTICE_FORBIDDEN} 이다 —
     * 두 코드가 갈리는 지점이 곧 「멤버인가」와 「쓸 수 있는가」의 경계다.
     *
     * @param groupId 공지를 붙일 그룹
     * @param userId 요청자 — 탈퇴 확정 계정이 유령 공지를 남기지 못하도록 공유 락으로 활성 검증한다
     * @param request 제목·본문
     */
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

    /**
     * 그룹 공지를 최신순으로 전부 읽는다 — 페이지네이션이 없다.
     *
     * @param groupId 조회할 그룹
     * @param userId 요청자 — 그룹원이 아니면 {@code MEMBER_ONLY} 다. 작성 권한 여부는 조회에 영향이 없다
     * @return 최신순 공지 목록. 공지가 하나도 없으면 빈 목록이다
     */
    public List<GroupAnnouncementResponse> getAnnouncements(UUID groupId, UUID userId) {
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        User user = userQueryService.getCaller(userId);

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

    /**
     * 공지 제목·본문을 갈아끼운다. 부분 수정이 아니라 둘 다 덮어쓴다.
     *
     * @param groupId 공지가 속한 그룹
     * @param announcementId 수정할 공지 — 조회를 그룹으로 한 번 더 좁히므로 다른 그룹의 공지 id 는 {@code NOT_FOUND} 다
     * @param userId 요청자 — 작성 권한이 없으면 {@code NOTICE_FORBIDDEN}. 작성자 본인일 필요는 없다
     * @param request 새 제목·본문
     */
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

    /**
     * 공지를 지운다 — 소프트삭제가 아니라 행 삭제라 되돌릴 수 없다.
     *
     * @param groupId 공지가 속한 그룹
     * @param announcementId 삭제할 공지 — 다른 그룹의 공지 id 는 {@code NOT_FOUND} 다
     * @param userId 요청자 — 작성 권한이 없으면 {@code NOTICE_FORBIDDEN}. 작성자 본인일 필요는 없다
     */
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
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1237) — 공지 생성·수정·삭제처럼
     * users 행은 <b>읽기만 하고</b> 그룹 자원을 변경하는 트랜잭션의 요청자 로드. 락 없는 findById 는
     * 계정 탈퇴(UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아 탈퇴의 정리 스캔 이후·커밋
     * 이전에 낀 변경이 유령(탈퇴자 명의 공지)으로 남는다. 수정·삭제는 작성이 아닌 권한 행사지만,
     * is_deleted 필터로 탈퇴자 토큰의 그룹 상태 변경을 차단하고 finder 를 통일하는 목적으로 같은
     * 경로를 태운다. 탈퇴가 먼저 커밋되면 READ COMMITTED 재평가로 빈 결과 → USER_NOT_FOUND(404)
     * — 그룹·공지 부재와 구분되는 <b>요청자 세션</b> 전용 코드다(GROMO-1247).
     * 게스트도 소셜 로그인 유저와 동일하게 통과한다(GROMO-1509).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userQueryService.getCallerForShare(userId);
    }
}

package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.dto.GroupAnnouncementResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * GroupAnnouncementService 단위 테스트 골격.
 *
 * <p>대상: 공지 생성/조회/수정/삭제.
 * 핵심 검증 포인트는 멤버십 존재, 그리고 공지 관리 권한
 * (GROMO-676: OWNER ∨ group_members.announcement_permission=ALLOW).
 */
@ExtendWith(MockitoExtension.class)
class GroupAnnouncementServiceTest {

    @InjectMocks
    private GroupAnnouncementService groupAnnouncementService;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private GroupAnnouncementRepository groupAnnouncementRepository;

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID ANNOUNCEMENT_ID = UUID.fromString("00000000-0000-0000-0000-0000000000b1");

    private User user(boolean guest) {
        return User.builder().id(USER_ID).isGuest(guest).build();
    }

    private Group group() {
        return Group.builder().id(GROUP_ID).build();
    }

    private GroupMember member(User user, Group group, GroupMemberRole role) {
        return GroupMember.builder().user(user).group(group).role(role).build();
    }

    private GroupMember memberWithPermission(User user, Group group, GroupAnnouncementGrant permission) {
        return GroupMember.builder().user(user).group(group)
                .role(GroupMemberRole.MEMBER).announcementPermission(permission).build();
    }

    // ── createAnnouncement ────────────────────────────────────────────────

    @Test
    @DisplayName("OWNER 가 공지 생성 → GroupAnnouncement 저장")
    void createAnnouncementByOwner() {
        // given: 요청자 OWNER, 그룹/멤버 존재
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.OWNER)));

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("제목", "내용");

        // when
        groupAnnouncementService.createAnnouncement(GROUP_ID, USER_ID, request);

        // then: 저장된 공지의 group/author/title/content 검증
        ArgumentCaptor<GroupAnnouncement> captor = ArgumentCaptor.forClass(GroupAnnouncement.class);
        verify(groupAnnouncementRepository).save(captor.capture());
        GroupAnnouncement saved = captor.getValue();
        assertThat(saved.getGroup()).isEqualTo(group);
        assertThat(saved.getUser()).isEqualTo(user);
        assertThat(saved.getTitle()).isEqualTo("제목");
        assertThat(saved.getContent()).isEqualTo("내용");
        // 락 규율 (GROMO-1237): 공지 생성(변경) 트랜잭션은 공유 락 활성 조회 — 무락 findById 금지.
        verify(userRepository).findActiveByIdForShare(USER_ID);
        verify(userRepository, never()).findById(USER_ID);
    }

    @Test
    @DisplayName("권한 부여(announcement_permission=ALLOW) 받은 멤버가 공지 생성 → 저장 성공")
    void createAnnouncementByGrantedMember() {
        // given: 일반 멤버지만 announcement_permission=ALLOW (GROMO-676)
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(memberWithPermission(user, group, GroupAnnouncementGrant.ALLOW)));

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("제목", "내용");

        // when
        groupAnnouncementService.createAnnouncement(GROUP_ID, USER_ID, request);

        // then
        verify(groupAnnouncementRepository).save(org.mockito.ArgumentMatchers.any(GroupAnnouncement.class));
    }

    @Test
    @DisplayName("게스트도 신원 가드에 걸리지 않는다 — 그룹 조회까지 진행 후 NOT_FOUND (GROMO-1509)")
    void createAnnouncementAllowsGuest() {
        // given: 게스트 유저, 그룹은 없음 — 가드가 남아 있으면 GUEST_FORBIDDEN 으로 먼저 튕겨 실패한다
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user(true)));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.empty());

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("제목", "내용");

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.createAnnouncement(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
        verify(groupAnnouncementRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    @Test
    @DisplayName("멤버가 아님 → GroupException(MEMBER_ONLY)")
    void createAnnouncementNotMember() {
        // given: 그룹은 있으나 멤버가 아님
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("제목", "내용");

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.createAnnouncement(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("권한 없는 일반 멤버 → GroupException(NOTICE_FORBIDDEN)")
    void createAnnouncementNoticeForbidden() {
        // given: 일반 멤버 + announcement_permission=DISALLOW(기본값)
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.MEMBER)));

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("제목", "내용");

        // when & then: 예외 발생 + 저장 미호출
        assertThatThrownBy(() -> groupAnnouncementService.createAnnouncement(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        verify(groupAnnouncementRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    // ── getAnnouncements ──────────────────────────────────────────────────

    @Test
    @DisplayName("공지 목록 조회 성공 → 최신순 응답 매핑")
    void getAnnouncementsSuccess() {
        // given: 멤버 + 공지 2개(최신순)
        User user = user(false);
        Group group = group();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.MEMBER)));

        GroupAnnouncement newer = GroupAnnouncement.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-0000000000b2"))
                .group(group).user(user).title("새 공지").content("새 내용")
                .createdAt(Instant.parse("2026-06-20T00:00:00Z"))
                .build();
        GroupAnnouncement older = GroupAnnouncement.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-0000000000b3"))
                .group(group).user(user).title("옛 공지").content("옛 내용")
                .createdAt(Instant.parse("2026-06-10T00:00:00Z"))
                .build();
        given(groupAnnouncementRepository.findByGroupOrderByCreatedAtDesc(group))
                .willReturn(List.of(newer, older));

        // when
        List<GroupAnnouncementResponse> result = groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID);

        // then: 순서 유지 + 필드 매핑
        assertThat(result).hasSize(2);
        assertThat(result.get(0).getTitle()).isEqualTo("새 공지");
        assertThat(result.get(0).getContent()).isEqualTo("새 내용");
        assertThat(result.get(0).getCreatedAt()).isEqualTo(Instant.parse("2026-06-20T00:00:00Z"));
        assertThat(result.get(1).getTitle()).isEqualTo("옛 공지");
    }

    @Test
    @DisplayName("게스트도 신원 가드에 걸리지 않는다 — 그룹 조회까지 진행 후 NOT_FOUND (GROMO-1509)")
    void getAnnouncementsAllowsGuest() {
        // given: 게스트 유저, 그룹은 없음 — 가드가 남아 있으면 GUEST_FORBIDDEN 으로 먼저 튕겨 실패한다
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user(true)));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("멤버가 아님 → GroupException(MEMBER_ONLY)")
    void getAnnouncementsNotMember() {
        // given: 그룹은 있으나 멤버가 아님
        User user = user(false);
        Group group = group();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("존재하지 않는(또는 탈퇴한) 유저 → UserException(USER_NOT_FOUND) (GROMO-1237 활성 필터·1247)")
    void getAnnouncementsUserNotFound() {
        // given: 무락 활성 조회가 빈 결과 — 탈퇴자 토큰 차단
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        // when & then: 그룹·공지 부재와 구분되는 요청자 전용 코드(GROMO-1247)
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── updateAnnouncement ────────────────────────────────────────────────

    @Test
    @DisplayName("공지 수정 성공 → 제목/내용 변경")
    void updateAnnouncementSuccess() {
        // given: OWNER + 해당 그룹의 공지 존재
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.OWNER)));

        GroupAnnouncement announcement = GroupAnnouncement.builder()
                .id(ANNOUNCEMENT_ID).group(group).user(user)
                .title("옛 제목").content("옛 내용").build();
        given(groupAnnouncementRepository.findByIdAndGroup(ANNOUNCEMENT_ID, group))
                .willReturn(Optional.of(announcement));

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("새 제목", "새 내용");

        // when
        groupAnnouncementService.updateAnnouncement(GROUP_ID, ANNOUNCEMENT_ID, USER_ID, request);

        // then: 도메인 객체에 반영
        assertThat(announcement.getTitle()).isEqualTo("새 제목");
        assertThat(announcement.getContent()).isEqualTo("새 내용");
    }

    @Test
    @DisplayName("권한 없음 → GroupException(NOTICE_FORBIDDEN)")
    void updateAnnouncementForbidden() {
        // given: 일반 멤버 + announcement_permission=DISALLOW (공지 조회 전에 권한에서 막힘)
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.MEMBER)));

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("새 제목", "새 내용");

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.updateAnnouncement(GROUP_ID, ANNOUNCEMENT_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
    }

    @Test
    @DisplayName("공지 없음 → GroupException(NOT_FOUND)")
    void updateAnnouncementNotFound() {
        // given: 권한 있으나 공지 미존재
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.OWNER)));
        given(groupAnnouncementRepository.findByIdAndGroup(ANNOUNCEMENT_ID, group))
                .willReturn(Optional.empty());

        CreateAnnouncementRequest request = new CreateAnnouncementRequest("새 제목", "새 내용");

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.updateAnnouncement(GROUP_ID, ANNOUNCEMENT_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    // ── deleteAnnouncement ────────────────────────────────────────────────

    @Test
    @DisplayName("공지 삭제 성공 → delete 호출")
    void deleteAnnouncementSuccess() {
        // given: OWNER + 공지 존재
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.OWNER)));

        GroupAnnouncement announcement = GroupAnnouncement.builder()
                .id(ANNOUNCEMENT_ID).group(group).user(user)
                .title("제목").content("내용").build();
        given(groupAnnouncementRepository.findByIdAndGroup(ANNOUNCEMENT_ID, group))
                .willReturn(Optional.of(announcement));

        // when
        groupAnnouncementService.deleteAnnouncement(GROUP_ID, ANNOUNCEMENT_ID, USER_ID);

        // then
        verify(groupAnnouncementRepository).delete(announcement);
    }

    @Test
    @DisplayName("권한 없음 → GroupException(NOTICE_FORBIDDEN)")
    void deleteAnnouncementForbidden() {
        // given: 일반 멤버 + announcement_permission=DISALLOW
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.MEMBER)));

        // when & then: 예외 발생 + 삭제 미호출
        assertThatThrownBy(() -> groupAnnouncementService.deleteAnnouncement(GROUP_ID, ANNOUNCEMENT_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        verify(groupAnnouncementRepository, never()).delete(org.mockito.ArgumentMatchers.any());
    }

    @Test
    @DisplayName("공지 없음 → GroupException(NOT_FOUND)")
    void deleteAnnouncementNotFound() {
        // given: 권한 있으나 공지 미존재
        User user = user(false);
        Group group = group();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(member(user, group, GroupMemberRole.OWNER)));
        given(groupAnnouncementRepository.findByIdAndGroup(ANNOUNCEMENT_ID, group))
                .willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.deleteAnnouncement(GROUP_ID, ANNOUNCEMENT_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }
}

package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.group.domain.GroupAnnouncement;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupNoticeGrantRepository;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.dto.GroupAnnouncementResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.dto.GroupDetailResponse;
import com.oneorthree.phone.group.dto.GroupSearchResponse;
import com.oneorthree.phone.group.dto.GroupOverviewResponse;
import com.oneorthree.phone.group.dto.GroupSummaryResponse;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.dto.RenewGroupCodeResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class GroupServiceTest {

    @InjectMocks
    private GroupService groupService;

    @InjectMocks
    private GroupAnnouncementService groupAnnouncementService;

    @InjectMocks
    private GroupChallengeService groupChallengeService;

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
    private PasswordEncoder passwordEncoder;

    @Mock
    private GroupAnnouncementRepository groupAnnouncementRepository;

    @Mock
    private GroupChallengeRepository groupChallengeRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private GroupNoticeGrantRepository groupNoticeGrantRepository;

    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID GROUP_ID_2 = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID GROUP_ID_99 = UUID.fromString("00000000-0000-0000-0000-000000000099");
    private static final UUID GROUP_SAVE_ID = UUID.fromString("00000000-0000-0000-0000-000000000010");
    private static final UUID ANNOUNCEMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000010");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-000000000020");

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    private CreateGroupRequest durationRequest(String password, Integer maxMembers, Integer durationMinutes) {
        return new CreateGroupRequest("스터디룸", password, "설명", maxMembers,
                MissionType.DURATION, MissionCategory.FOCUS, durationMinutes, null, null);
    }

    private CreateGroupRequest timeWindowRequest(Instant windowStart, Instant windowEnd) {
        return new CreateGroupRequest("스터디룸", null, "설명", 5,
                MissionType.TIME_WINDOW, MissionCategory.FOCUS, null, windowStart, windowEnd);
    }

    private User normalUser() {
        return User.builder().isGuest(false).build();
    }

    private Group groupWithCode(UUID id, String code, Instant codeExpiresAt) {
        return Group.builder().id(id).name("그룹").code(code)
                .maxMembers(10).status(GroupStatus.WAITING)
                .codeExpiresAt(codeExpiresAt).build();
    }

    /** save()가 id가 채워진 엔티티를 반환하도록 흉내낸다 (서비스가 group.getId()를 사용). */
    private void givenSaveReturnsGroupWithId(UUID id) {
        given(groupRepository.save(any(Group.class)))
                .willReturn(Group.builder().id(id).build());
    }

    // ── 정상 생성 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("정상 생성 → 그룹 저장 + OWNER 멤버 저장 + 8자 코드 반환")
    void createGroupSuccess() {
        // given
        CreateGroupRequest request = durationRequest("1234", null, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(false);
        given(passwordEncoder.encode("1234")).willReturn("hashed-pw");
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        // when
        CreateGroupResponse response = groupService.createGroup(USER_ID, request);

        // then
        assertThat(response.groupId()).isEqualTo(GROUP_SAVE_ID);
        assertThat(response.code()).hasSize(8);

        ArgumentCaptor<Group> groupCaptor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(groupCaptor.capture());
        Group savedGroup = groupCaptor.getValue();
        assertThat(savedGroup.getHostId()).isEqualTo(USER_ID);
        assertThat(savedGroup.getPassword()).isEqualTo("hashed-pw");
        assertThat(savedGroup.getCodeExpiresAt()).isAfter(Instant.now());

        ArgumentCaptor<GroupMember> memberCaptor = ArgumentCaptor.forClass(GroupMember.class);
        verify(groupMemberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(GroupMemberRole.OWNER);
    }

    @Test
    @DisplayName("maxMembers 미지정 → 기본값 10으로 저장")
    void createGroupDefaultsMaxMembers() {
        // given
        CreateGroupRequest request = durationRequest(null, null, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        ArgumentCaptor<Group> captor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(captor.capture());
        assertThat(captor.getValue().getMaxMembers()).isEqualTo(10);
    }

    @Test
    @DisplayName("비밀번호 없으면 BCrypt 인코딩을 호출하지 않고 password=null로 저장")
    void createGroupWithoutPassword() {
        // given
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        verify(passwordEncoder, never()).encode(anyString());
        ArgumentCaptor<Group> captor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(captor.capture());
        assertThat(captor.getValue().getPassword()).isNull();
    }

    // ── 게스트 / 유저 검증 ────────────────────────────────────────────────

    @Test
    @DisplayName("게스트 계정 → GUEST_FORBIDDEN, 그룹 저장 안 함")
    void createGroupRejectsGuest() {
        // given
        User guest = User.builder().isGuest(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, 60)))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("존재하지 않는 유저 → GroupException")
    void createGroupUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, 60)))
                .isInstanceOf(GroupException.class);
    }

    // ── 미션 파라미터 검증 ────────────────────────────────────────────────

    @Test
    @DisplayName("DURATION인데 durationMinutes 없음 → INVALID_MISSION_PARAMS")
    void createGroupDurationMissingMinutes() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, null)))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("TIME_WINDOW인데 windowStart/End 없음 → INVALID_MISSION_PARAMS")
    void createGroupTimeWindowMissingRange() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, timeWindowRequest(Instant.now(), null)))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, never()).save(any());
    }

    // ── 참가 코드 생성 ────────────────────────────────────────────────────

    @Test
    @DisplayName("코드 충돌 시 재시도 후 성공")
    void createGroupRetriesOnCodeCollision() {
        // given: 첫 코드는 충돌(이미 존재), 두 번째는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(true, false);
        given(groupRepository.findByCode(anyString())).willReturn(Optional.empty());
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        verify(groupRepository, times(2)).existsByCode(anyString());
        verify(groupRepository).save(any(Group.class));
    }

    @Test
    @DisplayName("10회 모두 충돌 → CODE_GENERATION_FAILED, 저장 안 함")
    void createGroupFailsAfterMaxRetries() {
        // given: 항상 충돌
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(true);
        given(groupRepository.findByCode(anyString())).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, request))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, times(10)).existsByCode(anyString());
        verify(groupRepository, never()).save(any());
    }

    // ── getMyGroups ───────────────────────────────────────────────────────

    @Test
    @DisplayName("내 그룹 목록 조회 성공 → 참여 그룹 수만큼 반환")
    void getMyGroupsSuccess() {
        // given
        User user = normalUser();
        Group group1 = Group.builder().id(GROUP_ID).name("그룹A").code("AAAA1111")
                .maxMembers(5).status(GroupStatus.WAITING).build();
        Group group2 = Group.builder().id(GROUP_ID_2).name("그룹B").code("BBBB2222")
                .maxMembers(10).status(GroupStatus.ACTIVE).build();

        GroupMember member1 = GroupMember.builder().user(user).group(group1).role(GroupMemberRole.OWNER).build();
        GroupMember member2 = GroupMember.builder().user(user).group(group2).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUser(user)).willReturn(List.of(member1, member2));
        given(groupMemberRepository.findByGroup(group1)).willReturn(List.of(member1));
        given(groupMemberRepository.findByGroup(group2)).willReturn(List.of(member2));

        // when
        List<GroupSummaryResponse> result = groupService.getMyGroups(USER_ID);

        // then
        assertThat(result).hasSize(2);

        GroupSummaryResponse first = result.get(0);
        assertThat(first.getGroupId()).isEqualTo(GROUP_ID);
        assertThat(first.getName()).isEqualTo("그룹A");
        assertThat(first.getRole()).isEqualTo(GroupMemberRole.OWNER);
        assertThat(first.getCurrentMembers()).isEqualTo(1);
        assertThat(first.getStatus()).isEqualTo(GroupStatus.WAITING);

        GroupSummaryResponse second = result.get(1);
        assertThat(second.getGroupId()).isEqualTo(GROUP_ID_2);
        assertThat(second.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(second.getStatus()).isEqualTo(GroupStatus.ACTIVE);
    }

    @Test
    @DisplayName("참여 그룹 없으면 빈 리스트 반환")
    void getMyGroupsEmpty() {
        // given
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUser(user)).willReturn(List.of());

        // when
        List<GroupSummaryResponse> result = groupService.getMyGroups(USER_ID);

        // then
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException")
    void getMyGroupsUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getMyGroups(USER_ID))
                .isInstanceOf(UserException.class);
    }

    // ── searchGroups ──────────────────────────────────────────────────────

    @Test
    @DisplayName("null 쿼리 → 빈 리스트 반환, 레포지토리 호출 없음")
    void searchGroupsNullQuery() {
        List<GroupSearchResponse> result = groupService.searchGroups(null);

        assertThat(result).isEmpty();
        verify(groupRepository, never()).findByCode(anyString());
        verify(groupRepository, never()).findByNameContainingIgnoreCase(anyString());
    }

    @Test
    @DisplayName("빈 문자열 쿼리 → 빈 리스트 반환, 레포지토리 호출 없음")
    void searchGroupsEmptyQuery() {
        List<GroupSearchResponse> result = groupService.searchGroups("");

        assertThat(result).isEmpty();
        verify(groupRepository, never()).findByCode(anyString());
        verify(groupRepository, never()).findByNameContainingIgnoreCase(anyString());
    }

    @Test
    @DisplayName("유효한 코드 정확 매칭 → 결과 첫 번째로 반환")
    void searchGroupsByValidCode() {
        // given
        String code = "ABCD1234";
        Group group = groupWithCode(GROUP_ID, code, Instant.now().plus(1, ChronoUnit.HOURS));

        given(groupRepository.findByCode(code)).willReturn(Optional.of(group));
        given(groupRepository.findByNameContainingIgnoreCase(code)).willReturn(List.of());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(code);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
    }

    @Test
    @DisplayName("만료된 코드 → 코드 매칭 제외")
    void searchGroupsByExpiredCode() {
        // given
        String code = "ABCD1234";
        Group group = groupWithCode(GROUP_ID, code, Instant.now().minus(1, ChronoUnit.HOURS));

        given(groupRepository.findByCode(code)).willReturn(Optional.of(group));
        given(groupRepository.findByNameContainingIgnoreCase(code)).willReturn(List.of());

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(code);

        // then
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("코드 만료 시각 null → 코드 매칭 제외 (lazy null 패턴)")
    void searchGroupsByNullExpiryCode() {
        // given
        String code = "ABCD1234";
        Group group = groupWithCode(GROUP_ID, code, null);

        given(groupRepository.findByCode(code)).willReturn(Optional.of(group));
        given(groupRepository.findByNameContainingIgnoreCase(code)).willReturn(List.of());

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(code);

        // then
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("이름 검색 성공 → 매칭 그룹 반환, hasPassword 필드 정확")
    void searchGroupsByName() {
        // given
        String query = "스터디";
        Group groupA = Group.builder().id(GROUP_ID).name("스터디A").maxMembers(5)
                .status(GroupStatus.WAITING).build();
        Group groupB = Group.builder().id(GROUP_ID_2).name("스터디B").maxMembers(10)
                .status(GroupStatus.ACTIVE).password("hashed").build();

        given(groupRepository.findByCode(query.toUpperCase())).willReturn(Optional.empty());
        given(groupRepository.findByNameContainingIgnoreCase(query)).willReturn(List.of(groupA, groupB));
        given(groupMemberRepository.findByGroup(groupA)).willReturn(List.of());
        given(groupMemberRepository.findByGroup(groupB)).willReturn(List.of());

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(query);

        // then
        assertThat(result).hasSize(2);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
        assertThat(result.get(0).isHasPassword()).isFalse();
        assertThat(result.get(1).getGroupId()).isEqualTo(GROUP_ID_2);
        assertThat(result.get(1).isHasPassword()).isTrue();
    }

    @Test
    @DisplayName("유효 코드 매칭이 이름 검색에도 포함되면 중복 제거")
    void searchGroupsDeduplicatesCodeAndNameMatch() {
        // given
        String code = "ABCD1234";
        Group group = groupWithCode(GROUP_ID, code, Instant.now().plus(1, ChronoUnit.HOURS));

        given(groupRepository.findByCode(code)).willReturn(Optional.of(group));
        given(groupRepository.findByNameContainingIgnoreCase(code)).willReturn(List.of(group));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(code);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
    }

    // ── getGroupOverview ──────────────────────────────────────────────────

    @Test
    @DisplayName("멤버인 유저 → isMember=true, 전체 필드 정상 반환")
    void getGroupOverviewMember() {
        // given
        User user = normalUser();
        Group group = Group.builder()
                .id(GROUP_ID).name("스터디룸").description("열심히 공부")
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .durationMinutes(60).maxMembers(10).status(GroupStatus.WAITING).build();
        GroupMember member = GroupMember.builder().user(user).group(group).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member));

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.getId()).isEqualTo(GROUP_ID);
        assertThat(result.getName()).isEqualTo("스터디룸");
        assertThat(result.getMemberCount()).isEqualTo(1);
        assertThat(result.isMember()).isTrue();
        assertThat(result.isHasPassword()).isFalse();
    }

    @Test
    @DisplayName("멤버 아닌 유저 → isMember=false")
    void getGroupOverviewNotMember() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .maxMembers(10).status(GroupStatus.WAITING).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.isMember()).isFalse();
        assertThat(result.getMemberCount()).isEqualTo(0);
    }

    @Test
    @DisplayName("비밀번호 그룹 → hasPassword=true")
    void getGroupOverviewHasPassword() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("비밀방").password("hashed-pw")
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .maxMembers(5).status(GroupStatus.WAITING).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.isHasPassword()).isTrue();
    }

    @Test
    @DisplayName("존재하지 않는 groupId → GroupException")
    void getGroupOverviewGroupNotFound() {
        // given
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupOverview(GROUP_ID_99, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 userId → UserException")
    void getGroupOverviewUserNotFound() {
        // given
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .maxMembers(10).status(GroupStatus.WAITING).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupOverview(GROUP_ID, USER_ID))
                .isInstanceOf(UserException.class);
    }

    @Test
    @DisplayName("코드 매칭 첫 번째, 이름 매칭 뒤에 추가")
    void searchGroupsCodeFirstThenName() {
        // given
        String code = "ABCD1234";
        Group codeGroup = groupWithCode(GROUP_ID, code, Instant.now().plus(1, ChronoUnit.HOURS));
        Group nameGroup = Group.builder().id(GROUP_ID_2).name("ABCD스터디").maxMembers(5)
                .status(GroupStatus.WAITING).build();

        given(groupRepository.findByCode(code)).willReturn(Optional.of(codeGroup));
        given(groupRepository.findByNameContainingIgnoreCase(code)).willReturn(List.of(nameGroup));
        given(groupMemberRepository.findByGroup(codeGroup)).willReturn(List.of());
        given(groupMemberRepository.findByGroup(nameGroup)).willReturn(List.of());

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(code);

        // then
        assertThat(result).hasSize(2);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
        assertThat(result.get(1).getGroupId()).isEqualTo(GROUP_ID_2);
    }

    // ── renewGroupCode (GROMO-347) ────────────────────────────────────────

    @Test
    @DisplayName("OWNER가 호출 → 새 코드 + 3시간 후 만료시각 반환")
    void renewGroupCodeOwnerSuccess() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "OLD12345", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember owner = GroupMember.builder().user(user).group(group).role(GroupMemberRole.OWNER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(owner));
        given(groupRepository.existsByCode(anyString())).willReturn(false);

        // when
        RenewGroupCodeResponse response = groupService.renewGroupCode(GROUP_ID, USER_ID);

        // then
        assertThat(response.getCode()).hasSize(8);
        assertThat(response.getCodeExpiresAt()).isAfter(Instant.now());
    }

    @Test
    @DisplayName("MEMBER가 호출 → NOT_OWNER")
    void renewGroupCodeMemberForbidden() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "OLD12345", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("그룹 멤버 아님 → NOT_OWNER")
    void renewGroupCodeNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "OLD12345", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void renewGroupCodeGuestForbidden() {
        // given
        User guest = User.builder().isGuest(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void renewGroupCodeGroupNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID_99, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    // ── getGroupDetail (GROMO-285) ────────────────────────────────────────

    private User userWithNickname(UUID id, String nickname) {
        return User.builder().id(id).isGuest(false).nickname(nickname).build();
    }

    @Test
    @DisplayName("OWNER 조회 → code, codeExpiresAt 포함")
    void getGroupDetailOwnerSeesCode() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        Instant expiry = Instant.now().plus(3, ChronoUnit.HOURS);
        Group group = groupWithCode(GROUP_ID, "INVITE01", expiry);
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(ownerMember));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.getCode()).isEqualTo("INVITE01");
        assertThat(response.getCodeExpiresAt()).isEqualTo(expiry);
        assertThat(response.getMembers()).hasSize(1);
        assertThat(response.getMembers().get(0).getNickname()).isEqualTo("방장");
    }

    @Test
    @DisplayName("MEMBER 조회 → code=null, codeExpiresAt=null")
    void getGroupDetailMemberNoCode() {
        // given
        User member = userWithNickname(USER_ID, "멤버");
        Group group = groupWithCode(GROUP_ID, "INVITE01", Instant.now().plus(3, ChronoUnit.HOURS));
        GroupMember memberRole = GroupMember.builder().user(member).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(member));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(member, group)).willReturn(Optional.of(memberRole));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(memberRole));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.getCode()).isNull();
        assertThat(response.getCodeExpiresAt()).isNull();
    }

    @Test
    @DisplayName("그룹 멤버 아님 → MEMBER_ONLY")
    void getGroupDetailNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "INVITE01", Instant.now().plus(3, ChronoUnit.HOURS));

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void getGroupDetailGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void getGroupDetailGroupNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupDetail(GROUP_ID_99, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(GroupException.class);
    }

    // ── getAnnouncements (GROMO-287) ──────────────────────────────────────

    @Test
    @DisplayName("공지 목록 정상 조회 → 공지 수만큼 반환")
    void getAnnouncementsSuccess() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();
        GroupAnnouncement ann = GroupAnnouncement.builder()
                .id(ANNOUNCEMENT_ID).group(group).title("공지1").content("내용1")
                .createdAt(Instant.now()).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupAnnouncementRepository.findByGroupOrderByCreatedAtDesc(group)).willReturn(List.of(ann));

        // when
        List<GroupAnnouncementResponse> result = groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getTitle()).isEqualTo("공지1");
        assertThat(result.get(0).getContent()).isEqualTo("내용1");
    }

    @Test
    @DisplayName("그룹 멤버 아님 → MEMBER_ONLY")
    void getAnnouncementsNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void getAnnouncementsGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void getAnnouncementsGroupNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID_99, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    // ── getChallenges (GROMO-289) ─────────────────────────────────────────

    @Test
    @DisplayName("챌린지 목록 정상 조회 → 챌린지 수만큼 반환")
    void getChallengesSuccess() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group).missionType(MissionType.DURATION)
                .durationMinutes(60).status(GroupChallengeStatus.ACTIVE)
                .createdAt(Instant.now()).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupChallengeRepository.findByGroupOrderByCreatedAtDesc(group)).willReturn(List.of(challenge));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(result.get(0).getDurationMinutes()).isEqualTo(60);
        assertThat(result.get(0).getStatus()).isEqualTo(GroupChallengeStatus.ACTIVE);
    }

    @Test
    @DisplayName("그룹 멤버 아님 → MEMBER_ONLY")
    void getChallengesNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void getChallengesGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void getChallengesGroupNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID_99, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    // ── joinGroup ─────────────────────────────────────────────────────────

    private Group openGroup() {
        return Group.builder().id(GROUP_ID).name("스터디룸")
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .maxMembers(10).status(GroupStatus.WAITING).build();
    }

    private Group passwordGroup() {
        return Group.builder().id(GROUP_ID).name("비밀방").password("hashed-pw")
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .maxMembers(10).status(GroupStatus.WAITING).build();
    }

    @Test
    @DisplayName("비밀번호 없는 그룹 정상 참가 → GroupMember 저장")
    void joinGroupSuccess() {
        // given
        User user = normalUser();
        Group group = openGroup();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest());

        // then
        ArgumentCaptor<GroupMember> captor = ArgumentCaptor.forClass(GroupMember.class);
        verify(groupMemberRepository).save(captor.capture());
        assertThat(captor.getValue().getRole()).isEqualTo(GroupMemberRole.MEMBER);
    }

    @Test
    @DisplayName("비밀번호 그룹 올바른 비밀번호로 참가 성공")
    void joinGroupSuccessWithPassword() {
        // given
        User user = normalUser();
        Group group = passwordGroup();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        given(passwordEncoder.matches("1234", "hashed-pw")).willReturn(true);

        // when
        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest("1234"));

        // then
        verify(groupMemberRepository).save(any(GroupMember.class));
    }

    @Test
    @DisplayName("게스트 참가 → GUEST_FORBIDDEN")
    void joinGroupGuestForbidden() {
        // given
        User guest = User.builder().isGuest(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → GroupException NOT_FOUND")
    void joinGroupNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID_99, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("이미 참여 중인 그룹 → ALREADY_MEMBER")
    void joinGroupAlreadyMember() {
        // given
        User user = normalUser();
        Group group = openGroup();
        GroupMember existing = GroupMember.builder().user(user).group(group).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(existing));

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("정원 초과 → ROOM_FULL")
    void joinGroupRoomFull() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("꽉찬방")
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .maxMembers(2).status(GroupStatus.WAITING).build();
        List<GroupMember> members = List.of(
                GroupMember.builder().build(),
                GroupMember.builder().build()
        );

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(members);

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("비밀번호 불일치 → WRONG_PASSWORD")
    void joinGroupWrongPassword() {
        // given
        User user = normalUser();
        Group group = passwordGroup();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        given(passwordEncoder.matches(any(), anyString())).willReturn(false);

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("존재하지 않는 userId → UserException")
    void joinGroupUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(UserException.class);
    }

    // ── transferOwner (GROMO-355) ─────────────────────────────────────────

    private static final UUID TARGET_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    @DisplayName("OWNER가 MEMBER에게 위임 → 역할 교체 + hostId 갱신")
    void transferOwnerSuccess() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        User target = userWithNickname(TARGET_USER_ID, "멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();
        GroupMember targetMember = GroupMember.builder().user(target).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_USER_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.of(targetMember));

        // when
        groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID);

        // then
        assertThat(ownerMember.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(targetMember.getRole()).isEqualTo(GroupMemberRole.OWNER);
        assertThat(group.getHostId()).isEqualTo(TARGET_USER_ID);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void transferOwnerGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("MEMBER가 위임 시도 → NOT_OWNER")
    void transferOwnerNotOwner() {
        // given
        User user = userWithNickname(USER_ID, "일반멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userRepository.findById(TARGET_USER_ID)).willReturn(Optional.of(userWithNickname(TARGET_USER_ID, "대상")));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("그룹원 아닌 유저가 위임 시도 → NOT_OWNER")
    void transferOwnerCallerNotMember() {
        // given
        User user = userWithNickname(USER_ID, "비멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userRepository.findById(TARGET_USER_ID)).willReturn(Optional.of(userWithNickname(TARGET_USER_ID, "대상")));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void transferOwnerGroupNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(userRepository.findById(TARGET_USER_ID)).willReturn(Optional.of(userWithNickname(TARGET_USER_ID, "대상")));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID_99, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("대상 유저가 그룹원 아님 → NOT_FOUND")
    void transferOwnerTargetNotMember() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        User target = userWithNickname(TARGET_USER_ID, "비멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findById(TARGET_USER_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }
}

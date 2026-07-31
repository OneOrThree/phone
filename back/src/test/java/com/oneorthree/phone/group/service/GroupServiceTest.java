package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupJoinCode;
import com.oneorthree.phone.group.domain.GroupJoinCodeStatus;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupJoinCodeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.group.domain.GroupAnnouncement;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.dto.GroupAnnouncementResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.dto.GroupDetailResponse;
import com.oneorthree.phone.group.dto.GroupSearchResponse;
import com.oneorthree.phone.group.dto.GroupOverviewResponse;
import com.oneorthree.phone.group.dto.GroupSettingsResponse;
import com.oneorthree.phone.group.dto.GroupSummaryResponse;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.dto.RenewGroupCodeResponse;
import com.oneorthree.phone.group.dto.UpdateGroupSettingsRequest;
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
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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
    private GroupJoinCodeRepository groupJoinCodeRepository;

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
    private GroupChallengeDurationRepository groupChallengeDurationRepository;

    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

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
        return durationRequest(password, maxMembers, durationMinutes, false);
    }

    private CreateGroupRequest durationRequest(String password, Integer maxMembers, Integer durationMinutes,
            boolean isPrivate) {
        return CreateGroupRequest.builder()
                .name("스터디룸").password(password).description("설명").maxMembers(maxMembers)
                .isPrivate(isPrivate)
                .missionType(MissionType.DURATION).missionCategory(MissionCategory.FOCUS)
                .durationMinutes(durationMinutes)
                .build();
    }

    private CreateGroupRequest timeWindowRequest(Instant windowStart, Instant windowEnd) {
        return CreateGroupRequest.builder()
                .name("스터디룸").description("설명").maxMembers(5)
                .missionType(MissionType.TIME_WINDOW).missionCategory(MissionCategory.FOCUS)
                .windowStart(windowStart).windowEnd(windowEnd)
                .build();
    }

    private User normalUser() {
        return User.builder().isGuest(false).build();
    }

    // GROMO-672: 참가 코드는 이제 Group 이 아니라 GroupJoinCode(1:1) 소유.
    //   code/codeExpiresAt 인자는 매핑 소스인 GroupJoinCode 를 통해 검증한다(joinCodeFor).
    private Group groupWithCode(UUID id, String code, Instant codeExpiresAt) {
        return Group.builder().id(id).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();
    }

    private GroupJoinCode joinCodeFor(Group group, String code, Instant expiresAt) {
        return GroupJoinCode.builder().group(group).code(code)
                .status(GroupJoinCodeStatus.ACTIVE).expiresAt(expiresAt).build();
    }

    /** save()가 id가 채워진 엔티티를 반환하도록 흉내낸다 (서비스가 group.getId()를 사용). */
    private void givenSaveReturnsGroupWithId(UUID id) {
        given(groupRepository.save(any(Group.class)))
                .willReturn(Group.builder().id(id).build());
    }

    /** GROMO-674: 대표 챌린지(DURATION/FOCUS, ACTIVE) + duration 상세 스텁 — 상세/오버뷰 미션 필드 소스. */
    private void givenRepresentativeDurationChallenge(Group group, int durationMinutes) {
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group).type(MissionType.DURATION)
                .category(MissionCategory.FOCUS).status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(
                group, GroupChallengeStatus.ACTIVE)).willReturn(Optional.of(challenge));
        given(groupChallengeDurationRepository.findById(CHALLENGE_ID)).willReturn(
                Optional.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID).durationMinutes(durationMinutes).build()));
    }

    // ── 정상 생성 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("정상 생성 → 그룹 저장 + OWNER 멤버 저장 + 8자 코드 반환")
    void createGroupSuccess() {
        // given
        CreateGroupRequest request = durationRequest("1234", null, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
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
        assertThat(savedGroup.getPassword()).isEqualTo("hashed-pw");

        // GROMO-672: 참가 코드/만료시각은 GroupJoinCode(1:1) 로 저장
        ArgumentCaptor<GroupJoinCode> joinCodeCaptor = ArgumentCaptor.forClass(GroupJoinCode.class);
        verify(groupJoinCodeRepository).save(joinCodeCaptor.capture());
        GroupJoinCode savedJoinCode = joinCodeCaptor.getValue();
        assertThat(savedJoinCode.getCode()).hasSize(8);
        assertThat(savedJoinCode.getStatus()).isEqualTo(GroupJoinCodeStatus.ACTIVE);
        assertThat(savedJoinCode.getExpiresAt()).isAfter(Instant.now());

        ArgumentCaptor<GroupMember> memberCaptor = ArgumentCaptor.forClass(GroupMember.class);
        verify(groupMemberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(GroupMemberRole.OWNER);

        // GROMO-674: 미션 정보는 groups 컬럼 대신 대표 챌린지 + duration 상세로 저장
        ArgumentCaptor<GroupChallenge> challengeCaptor = ArgumentCaptor.forClass(GroupChallenge.class);
        verify(groupChallengeRepository).save(challengeCaptor.capture());
        GroupChallenge savedChallenge = challengeCaptor.getValue();
        assertThat(savedChallenge.getGroup().getId()).isEqualTo(GROUP_SAVE_ID);
        assertThat(savedChallenge.getType()).isEqualTo(MissionType.DURATION);
        assertThat(savedChallenge.getCategory()).isEqualTo(MissionCategory.FOCUS);
        assertThat(savedChallenge.getStatus()).isEqualTo(GroupChallengeStatus.ACTIVE);

        ArgumentCaptor<GroupChallengeDuration> durationCaptor = ArgumentCaptor.forClass(GroupChallengeDuration.class);
        verify(groupChallengeDurationRepository).save(durationCaptor.capture());
        assertThat(durationCaptor.getValue().getDurationMinutes()).isEqualTo(60);
        verify(groupChallengeWindowRepository, never()).save(any());
    }

    @Test
    @DisplayName("isPrivate=true 생성 → 비공개 그룹으로 저장")
    void createGroupPrivate() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        // when
        groupService.createGroup(USER_ID, durationRequest(null, 5, 60, true));

        // then
        ArgumentCaptor<Group> groupCaptor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(groupCaptor.capture());
        assertThat(groupCaptor.getValue().isPrivate()).isTrue();
    }

    @Test
    @DisplayName("isPrivate 미전송(기본값) → 공개 그룹으로 저장")
    void createGroupDefaultsToPublic() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        // when
        groupService.createGroup(USER_ID, durationRequest(null, 5, 60));

        // then
        ArgumentCaptor<Group> groupCaptor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(groupCaptor.capture());
        assertThat(groupCaptor.getValue().isPrivate()).isFalse();
    }

    @Test
    @DisplayName("TIME_WINDOW 생성 → 대표 챌린지 + window 상세 저장, duration 상세는 저장 안 함")
    void createGroupTimeWindowSavesWindowDetail() {
        // given
        Instant start = Instant.parse("2026-07-10T13:00:00Z");
        Instant end = Instant.parse("2026-07-10T15:00:00Z");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        // when
        groupService.createGroup(USER_ID, timeWindowRequest(start, end));

        // then
        ArgumentCaptor<GroupChallenge> challengeCaptor = ArgumentCaptor.forClass(GroupChallenge.class);
        verify(groupChallengeRepository).save(challengeCaptor.capture());
        assertThat(challengeCaptor.getValue().getType()).isEqualTo(MissionType.TIME_WINDOW);
        assertThat(challengeCaptor.getValue().getStatus()).isEqualTo(GroupChallengeStatus.ACTIVE);

        ArgumentCaptor<GroupChallengeWindow> windowCaptor = ArgumentCaptor.forClass(GroupChallengeWindow.class);
        verify(groupChallengeWindowRepository).save(windowCaptor.capture());
        assertThat(windowCaptor.getValue().getWindowStartAt()).isEqualTo(start);
        assertThat(windowCaptor.getValue().getWindowEndAt()).isEqualTo(end);
        verify(groupChallengeDurationRepository, never()).save(any());
    }

    @Test
    @DisplayName("maxMembers 미지정 → 기본값 10으로 저장")
    void createGroupDefaultsMaxMembers() {
        // given
        CreateGroupRequest request = durationRequest(null, null, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
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
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
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
        verify(groupChallengeRepository, never()).save(any());
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
        verify(groupChallengeRepository, never()).save(any());
    }

    // ── 참가 코드 생성 ────────────────────────────────────────────────────

    @Test
    @DisplayName("코드 충돌 시 재시도 후 성공")
    void createGroupRetriesOnCodeCollision() {
        // given: 첫 코드는 충돌(이미 존재), 두 번째는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true, false);
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.empty());
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        verify(groupJoinCodeRepository, times(2)).existsByCode(anyString());
        verify(groupRepository).save(any(Group.class));
    }

    @Test
    @DisplayName("10회 모두 충돌 → CODE_GENERATION_FAILED, 저장 안 함")
    void createGroupFailsAfterMaxRetries() {
        // given: 항상 충돌
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true);
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, request))
                .isInstanceOf(GroupException.class);
        verify(groupJoinCodeRepository, times(10)).existsByCode(anyString());
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("충돌 코드가 만료 상태면 ENDED 로 정리하고 다른 코드로 재시도")
    void createGroupExpiresStaleCollidingCode() {
        // given: 첫 코드 충돌 + 그 코드는 이미 만료 → expire() 대상, 두 번째 코드는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true, false);
        GroupJoinCode expiredCollision = joinCodeFor(Group.builder().id(GROUP_ID).build(), "OLDCODE1",
                Instant.now().minus(1, ChronoUnit.HOURS));
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.of(expiredCollision));
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then: 만료 충돌 코드는 ENDED 로 정리됨(재사용 아님 — 새 코드로 발급)
        assertThat(expiredCollision.getStatus()).isEqualTo(GroupJoinCodeStatus.ENDED);
        verify(groupRepository).save(any(Group.class));
    }

    @Test
    @DisplayName("충돌 코드가 아직 유효하면 상태를 건드리지 않고 재시도만 한다")
    void createGroupKeepsActiveCollidingCode() {
        // given: 첫 코드 충돌 + 그 코드는 아직 유효(미래 만료) → 상태 유지, 두 번째 코드는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true, false);
        GroupJoinCode activeCollision = joinCodeFor(Group.builder().id(GROUP_ID).build(), "LIVECODE",
                Instant.now().plus(1, ChronoUnit.HOURS));
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.of(activeCollision));
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then: 유효한 충돌 코드는 그대로 ACTIVE 유지
        assertThat(activeCollision.getStatus()).isEqualTo(GroupJoinCodeStatus.ACTIVE);
        verify(groupRepository).save(any(Group.class));
    }

    // ── getMyGroups ───────────────────────────────────────────────────────

    @Test
    @DisplayName("내 그룹 목록 조회 성공 → 참여 그룹 수만큼 반환")
    void getMyGroupsSuccess() {
        // given
        User user = normalUser();
        Group group1 = Group.builder().id(GROUP_ID).name("그룹A")
                .maxMembers(5).status(GroupStatus.WAITING).build();
        Group group2 = Group.builder().id(GROUP_ID_2).name("그룹B")
                .maxMembers(10).status(GroupStatus.ACTIVE).isPrivate(true).build();

        GroupMember member1 = GroupMember.builder().user(user).group(group1).role(GroupMemberRole.OWNER).build();
        GroupMember member2 = GroupMember.builder().user(user).group(group2).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUser(user)).willReturn(List.of(member1, member2));
        given(groupMemberRepository.findByGroup(group1)).willReturn(List.of(member1));
        given(groupMemberRepository.findByGroup(group2)).willReturn(List.of(member2));
        // GROMO-672: 요약 응답의 code 는 group_join_codes 일괄 조회(findAllById)로 채운다 — N+1 방지
        given(groupJoinCodeRepository.findAllById(List.of(GROUP_ID, GROUP_ID_2)))
                .willReturn(List.of(
                        GroupJoinCode.builder().groupId(GROUP_ID).group(group1).code("AAAA1111").build(),
                        GroupJoinCode.builder().groupId(GROUP_ID_2).group(group2).code("BBBB2222").build()));

        // when
        List<GroupSummaryResponse> result = groupService.getMyGroups(USER_ID);

        // then
        assertThat(result).hasSize(2);

        GroupSummaryResponse first = result.get(0);
        assertThat(first.getGroupId()).isEqualTo(GROUP_ID);
        assertThat(first.getName()).isEqualTo("그룹A");
        assertThat(first.getCode()).isEqualTo("AAAA1111");
        assertThat(first.getRole()).isEqualTo(GroupMemberRole.OWNER);
        assertThat(first.getCurrentMembers()).isEqualTo(1);
        assertThat(first.getStatus()).isEqualTo(GroupStatus.WAITING);
        assertThat(first.isPrivate()).isFalse();

        GroupSummaryResponse second = result.get(1);
        assertThat(second.getGroupId()).isEqualTo(GROUP_ID_2);
        assertThat(second.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(second.getStatus()).isEqualTo(GroupStatus.ACTIVE);
        assertThat(second.isPrivate()).isTrue();
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
        verify(groupRepository, never()).searchPublicByNameTrgm(anyString(), anyInt());
    }

    @Test
    @DisplayName("빈 문자열 쿼리 → 빈 리스트 반환, 레포지토리 호출 없음")
    void searchGroupsEmptyQuery() {
        List<GroupSearchResponse> result = groupService.searchGroups("");

        assertThat(result).isEmpty();
        verify(groupRepository, never()).searchPublicByNameTrgm(anyString(), anyInt());
    }

    @Test
    @DisplayName("공백만 있는 쿼리 → 빈 리스트 반환, 레포지토리 호출 없음")
    void searchGroupsBlankQuery() {
        List<GroupSearchResponse> result = groupService.searchGroups("   ");

        assertThat(result).isEmpty();
        verify(groupRepository, never()).searchPublicByNameTrgm(anyString(), anyInt());
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

        given(groupRepository.searchPublicByNameTrgm(query, 20)).willReturn(List.of(groupA, groupB));
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
    @DisplayName("검색은 LIMIT 20 으로 위임한다 — 무제한 반환하지 않는다")
    void searchGroupsAppliesLimit() {
        // given
        String query = "스터디";
        given(groupRepository.searchPublicByNameTrgm(query, 20)).willReturn(List.of());

        // when
        groupService.searchGroups(query);

        // then: is_private=false · deleted_at IS NULL 필터와 LIMIT 은 네이티브 쿼리가 책임진다
        //   (ci 프로파일은 Flyway 비활성이라 trgm 확장·인덱스가 없어 모킹으로만 검증 가능)
        ArgumentCaptor<Integer> limitCaptor = ArgumentCaptor.forClass(Integer.class);
        verify(groupRepository).searchPublicByNameTrgm(eq(query), limitCaptor.capture());
        assertThat(limitCaptor.getValue()).isEqualTo(20);
    }

    @Test
    @DisplayName("비공개 그룹은 검색 결과에서 제외된다 — 코드 정확 매칭 분기도 사라졌다")
    void searchGroupsExcludesPrivateGroups() {
        // given: 레포지토리(is_private=false 필터)가 공개 그룹만 돌려준다
        String query = "스터디";
        Group publicGroup = Group.builder().id(GROUP_ID).name("스터디공개").maxMembers(5)
                .status(GroupStatus.WAITING).isPrivate(false).build();

        given(groupRepository.searchPublicByNameTrgm(query, 20)).willReturn(List.of(publicGroup));
        given(groupMemberRepository.findByGroup(publicGroup)).willReturn(List.of());

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(query);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
        // 참가 코드 체계 폐기(2026-07-31) — 검색은 더 이상 group_join_codes 를 보지 않는다
        verify(groupJoinCodeRepository, never()).findByCode(anyString());
    }

    // ── getGroupOverview ──────────────────────────────────────────────────

    @Test
    @DisplayName("멤버인 유저 → isMember=true, 전체 필드 정상 반환")
    void getGroupOverviewMember() {
        // given
        User user = normalUser();
        Group group = Group.builder()
                .id(GROUP_ID).name("스터디룸").description("열심히 공부")
                .maxMembers(10).status(GroupStatus.WAITING).build();
        GroupMember member = GroupMember.builder().user(user).group(group).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member));
        givenRepresentativeDurationChallenge(group, 60);

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.getId()).isEqualTo(GROUP_ID);
        assertThat(result.getName()).isEqualTo("스터디룸");
        assertThat(result.getMemberCount()).isEqualTo(1);
        assertThat(result.isMember()).isTrue();
        assertThat(result.isHasPassword()).isFalse();
        // GROMO-674: 미션 필드는 대표 챌린지(+duration 상세)에서 채워진다
        assertThat(result.getMissionCategory()).isEqualTo(MissionCategory.FOCUS);
        assertThat(result.getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(result.getDurationMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("TIME_WINDOW 대표 챌린지 → windowStart/windowEnd 는 window 상세에서 채움")
    void getGroupOverviewTimeWindowMission() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();
        Instant start = Instant.parse("2026-07-10T13:00:00Z");
        Instant end = Instant.parse("2026-07-10T15:00:00Z");
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group).type(MissionType.TIME_WINDOW)
                .category(MissionCategory.SCREEN_TIME).status(GroupChallengeStatus.ACTIVE).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        given(groupChallengeRepository.findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(
                group, GroupChallengeStatus.ACTIVE)).willReturn(Optional.of(challenge));
        given(groupChallengeWindowRepository.findById(CHALLENGE_ID)).willReturn(
                Optional.of(GroupChallengeWindow.builder()
                        .challengeId(CHALLENGE_ID).windowStartAt(start).windowEndAt(end).build()));

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.getMissionCategory()).isEqualTo(MissionCategory.SCREEN_TIME);
        assertThat(result.getMissionType()).isEqualTo(MissionType.TIME_WINDOW);
        assertThat(result.getWindowStart()).isEqualTo(start);
        assertThat(result.getWindowEnd()).isEqualTo(end);
        assertThat(result.getDurationMinutes()).isNull();
    }

    @Test
    @DisplayName("멤버 아닌 유저 → isMember=false")
    void getGroupOverviewNotMember() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("그룹")
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
        // GROMO-674: 대표 챌린지(ACTIVE)가 없으면 미션 필드는 null
        assertThat(result.getMissionCategory()).isNull();
        assertThat(result.getMissionType()).isNull();
    }

    @Test
    @DisplayName("비밀번호 그룹 → hasPassword=true")
    void getGroupOverviewHasPassword() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("비밀방").password("hashed-pw")
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
                .maxMembers(10).status(GroupStatus.WAITING).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupOverview(GROUP_ID, USER_ID))
                .isInstanceOf(UserException.class);
    }

    // ── renewGroupCode (GROMO-347) ────────────────────────────────────────

    @Test
    @DisplayName("OWNER가 호출 → 새 코드 + 3시간 후 만료시각 반환")
    void renewGroupCodeOwnerSuccess() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "OLD12345", null);
        GroupMember owner = GroupMember.builder().user(user).group(group).role(GroupMemberRole.OWNER).build();
        GroupJoinCode joinCode = joinCodeFor(group, "OLD12345", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(owner));
        given(groupJoinCodeRepository.findById(GROUP_ID)).willReturn(Optional.of(joinCode));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);

        // when
        RenewGroupCodeResponse response = groupService.renewGroupCode(GROUP_ID, USER_ID);

        // then
        assertThat(response.getCode()).hasSize(8);
        assertThat(response.getCode()).isNotEqualTo("OLD12345");
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
        Group group = groupWithCode(GROUP_ID, "INVITE01", null);
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(ownerMember));
        givenRepresentativeDurationChallenge(group, 60);
        // GROMO-672: OWNER 상세의 code/codeExpiresAt 은 group_join_codes 에서 조회
        given(groupJoinCodeRepository.findById(GROUP_ID))
                .willReturn(Optional.of(joinCodeFor(group, "INVITE01", expiry)));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.getCode()).isEqualTo("INVITE01");
        assertThat(response.getCodeExpiresAt()).isEqualTo(expiry);
        assertThat(response.getMembers()).hasSize(1);
        assertThat(response.getMembers().get(0).getNickname()).isEqualTo("방장");
        // GROMO-674: 미션 필드는 대표 챌린지(+duration 상세)에서 채워진다
        assertThat(response.getMissionCategory()).isEqualTo(MissionCategory.FOCUS);
        assertThat(response.getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(response.getDurationMinutes()).isEqualTo(60);
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
        assertThat(response.isPrivate()).isFalse();
    }

    @Test
    @DisplayName("비공개 그룹 상세 → isPrivate=true")
    void getGroupDetailPrivateGroup() {
        // given
        User member = userWithNickname(USER_ID, "멤버");
        Group group = Group.builder().id(GROUP_ID).name("비밀방")
                .maxMembers(10).status(GroupStatus.WAITING).isPrivate(true).build();
        GroupMember memberRole = GroupMember.builder().user(member).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(member));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(member, group)).willReturn(Optional.of(memberRole));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(memberRole));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.isPrivate()).isTrue();
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
                .id(CHALLENGE_ID).group(group).type(MissionType.DURATION)
                .category(MissionCategory.FOCUS).status(GroupChallengeStatus.ACTIVE)
                .createdAt(Instant.now()).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupChallengeRepository.findByGroupOrderByCreatedAtDesc(group)).willReturn(List.of(challenge));
        // GROMO-674: durationMinutes 는 CTI 상세 배치 조회로 채워진다
        given(groupChallengeDurationRepository.findByChallengeIdIn(List.of(CHALLENGE_ID)))
                .willReturn(List.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID).durationMinutes(60).build()));

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
                .maxMembers(10).status(GroupStatus.WAITING).build();
    }

    private Group passwordGroup() {
        return Group.builder().id(GROUP_ID).name("비밀방").password("hashed-pw")
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
    @DisplayName("OWNER가 MEMBER에게 위임 → 역할 교체(OWNER↔MEMBER)")
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

        // then: GROMO-676 — host_id 폐기, 방장 이양은 role 교체로만 검증
        assertThat(ownerMember.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(targetMember.getRole()).isEqualTo(GroupMemberRole.OWNER);
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

    // ── 공지 권한(announcement_permission) 재배선 (GROMO-676) ─────────────

    private GroupMember ownerMemberOf(User owner, Group group) {
        return GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();
    }

    private GroupMember memberWithPermission(User user, Group group, GroupAnnouncementGrant permission) {
        return GroupMember.builder().user(user).group(group)
                .role(GroupMemberRole.MEMBER).announcementPermission(permission).build();
    }

    @Test
    @DisplayName("설정 조회 → noticeGrantedUserIds 는 announcement_permission=ALLOW 멤버만 (방장 제외)")
    void getGroupSettingsNoticeGrantedFromMembers() {
        // given: 방장 + ALLOW 멤버 + DISALLOW(기본값) 멤버
        User owner = userWithNickname(USER_ID, "방장");
        User granted = userWithNickname(TARGET_USER_ID, "허용멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember grantedMember = memberWithPermission(granted, group, GroupAnnouncementGrant.ALLOW);
        GroupMember plainMember = memberWithPermission(
                userWithNickname(UUID.fromString("00000000-0000-0000-0000-000000000003"), "일반멤버"),
                group, GroupAnnouncementGrant.DISALLOW);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group))
                .willReturn(List.of(ownerMember, grantedMember, plainMember));

        // when
        GroupSettingsResponse response = groupService.getGroupSettings(GROUP_ID, USER_ID);

        // then: ALLOW 멤버만 포함
        assertThat(response.getNoticeGrantedUserIds()).containsExactly(TARGET_USER_ID);
    }

    @Test
    @DisplayName("설정 변경(noticeGrantedUserIds) → 대상 멤버 ALLOW, 미포함 멤버 회수, 방장 불변")
    void updateGroupSettingsRewiresAnnouncementPermission() {
        // given: 방장 + 부여 대상(DISALLOW) + 회수 대상(기존 ALLOW)
        User owner = userWithNickname(USER_ID, "방장");
        User grantee = userWithNickname(TARGET_USER_ID, "부여대상");
        User revokee = userWithNickname(UUID.fromString("00000000-0000-0000-0000-000000000003"), "회수대상");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember granteeMember = memberWithPermission(grantee, group, GroupAnnouncementGrant.DISALLOW);
        GroupMember revokeeMember = memberWithPermission(revokee, group, GroupAnnouncementGrant.ALLOW);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group))
                .willReturn(List.of(ownerMember, granteeMember, revokeeMember));

        UpdateGroupSettingsRequest request =
                new UpdateGroupSettingsRequest(null, null, null, List.of(TARGET_USER_ID));

        // when
        groupService.updateGroupSettings(GROUP_ID, USER_ID, request);

        // then: 목록에 있으면 ALLOW, 없으면 DISALLOW, 방장은 role 로 항상 가능하므로 컬럼 불변
        assertThat(granteeMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.ALLOW);
        assertThat(revokeeMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.DISALLOW);
        assertThat(ownerMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.DISALLOW);
    }

    @Test
    @DisplayName("설정 변경(noticeGrantedUserIds=빈 리스트) → 전원 회수, 방장 불변")
    void updateGroupSettingsEmptyNoticeGrantedRevokesAll() {
        // given: 방장 + ALLOW 멤버 2명 (빈 리스트 = 전원 초기화 케이스, PR #178 리뷰)
        User owner = userWithNickname(USER_ID, "방장");
        User memberA = userWithNickname(TARGET_USER_ID, "멤버A");
        User memberB = userWithNickname(UUID.fromString("00000000-0000-0000-0000-000000000003"), "멤버B");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember allowA = memberWithPermission(memberA, group, GroupAnnouncementGrant.ALLOW);
        GroupMember allowB = memberWithPermission(memberB, group, GroupAnnouncementGrant.ALLOW);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(ownerMember, allowA, allowB));

        UpdateGroupSettingsRequest request = new UpdateGroupSettingsRequest(null, null, null, List.of());

        // when
        groupService.updateGroupSettings(GROUP_ID, USER_ID, request);

        // then: 전 멤버 DISALLOW 회수, 방장은 컬럼 불변(role 로 항상 가능)
        assertThat(allowA.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.DISALLOW);
        assertThat(allowB.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.DISALLOW);
        assertThat(ownerMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.DISALLOW);
    }

    @Test
    @DisplayName("설정 변경(noticeGrantedUserIds=null) → 공지 권한 미변경, 나머지 설정만 반영")
    void updateGroupSettingsNullNoticeGrantedKeepsPermissions() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));

        UpdateGroupSettingsRequest request = new UpdateGroupSettingsRequest(false, 10, null, null);

        // when
        groupService.updateGroupSettings(GROUP_ID, USER_ID, request);

        // then: 멤버 권한 일괄 반영 없음(findByGroup 미호출) + 채팅 설정 반영
        verify(groupMemberRepository, never()).findByGroup(group);
        assertThat(group.isChatEnabled()).isFalse();
        assertThat(group.getChatLimitPerPerson()).isEqualTo(10);
    }

    @Test
    @DisplayName("그룹 상세 → noticeGrantedUserIds 는 announcement_permission=ALLOW 멤버만 (방장 제외)")
    void getGroupDetailNoticeGrantedFromMembers() {
        // given: 방장 + ALLOW 멤버
        User owner = userWithNickname(USER_ID, "방장");
        User granted = userWithNickname(TARGET_USER_ID, "허용멤버");
        Group group = groupWithCode(GROUP_ID, "INVITE01", Instant.now().plus(3, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember grantedMember = memberWithPermission(granted, group, GroupAnnouncementGrant.ALLOW);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(ownerMember, grantedMember));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.getNoticeGrantedUserIds()).containsExactly(TARGET_USER_ID);
    }
}

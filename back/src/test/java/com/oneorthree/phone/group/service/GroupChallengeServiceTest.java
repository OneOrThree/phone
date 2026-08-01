package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.ChallengeMemberProgressResponse;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * GroupChallengeService 단위 테스트.
 *
 * <p>대상: 챌린지 목록 조회, 생성(DURATION/TIME_WINDOW), 삭제.
 * 핵심 검증 포인트는 게스트 차단, OWNER 권한, 미션 파라미터 검증, 중복 차단,
 * SCREEN_TIME 비참여자 목록, CTI 상세(duration/window)의 저장·배치 로드,
 * windowStart/End 의 Instant→UTC "HH:mm:ss" 변환.
 *
 * <p>CreateChallengeRequest 는 all-args/builder 생성자가 없어 mock() 으로 대체한다.
 */
@ExtendWith(MockitoExtension.class)
class GroupChallengeServiceTest {

    @InjectMocks
    private GroupChallengeService groupChallengeService;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private GroupChallengeRepository groupChallengeRepository;

    @Mock
    private GroupChallengeDurationRepository groupChallengeDurationRepository;

    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;

    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private DailyScreenTimeStatRepository dailyScreenTimeStatRepository;

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID OTHER_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final LocalDate TODAY = LocalDate.of(2026, 8, 1);

    private User member() {
        return User.builder().id(USER_ID).nickname("재영").isGuest(false).build();
    }

    private UserScreenTimeSettings settings(UUID userId, boolean granted) {
        return UserScreenTimeSettings.builder().userId(userId).screenTimePermissionGranted(granted).build();
    }

    private User guest() {
        return User.builder().id(USER_ID).isGuest(true).build();
    }

    private GroupMember groupMemberOf(User user, Group group, GroupMemberRole role) {
        return GroupMember.builder().user(user).group(group).role(role).build();
    }

    // ── getChallenges ─────────────────────────────────────────────────────

    @Test
    @DisplayName("챌린지 목록 조회 성공 → 최신순 매핑 + canParticipate 계산")
    void getChallengesSuccess() {
        // given: 멤버 + FOCUS(DURATION) / SCREEN_TIME(TIME_WINDOW) 챌린지 혼합
        User user = member(); // screenTimePermissionGranted = false
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.MEMBER)));

        UUID screenTimeId = UUID.fromString("00000000-0000-0000-0000-0000000000c2");
        GroupChallenge focus = GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group)
                .type(MissionType.DURATION)
                .category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        GroupChallenge screenTime = GroupChallenge.builder()
                .id(screenTimeId)
                .group(group)
                .type(MissionType.TIME_WINDOW)
                .category(MissionCategory.SCREEN_TIME)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        given(groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group))
                .willReturn(List.of(focus, screenTime));

        // CTI 상세는 challengeId IN 배치 로드로 조회된다
        List<UUID> challengeIds = List.of(CHALLENGE_ID, screenTimeId);
        given(groupChallengeDurationRepository.findByChallengeIdIn(challengeIds))
                .willReturn(List.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID)
                        .durationMinutes(30)
                        .build()));
        given(groupChallengeWindowRepository.findByChallengeIdIn(challengeIds))
                .willReturn(List.of(GroupChallengeWindow.builder()
                        .challengeId(screenTimeId)
                        .windowStartAt(Instant.parse("2026-01-01T09:00:00Z")) // UTC → 09:00:00
                        .windowEndAt(Instant.parse("2026-01-01T18:00:00Z"))   // UTC → 18:00:00
                        .build()));
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(settings(USER_ID, false))); // 권한 미동의

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, null);

        // then
        assertThat(result).hasSize(2);

        GroupChallengeResponse focusResult = result.get(0);
        assertThat(focusResult.getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(focusResult.getMissionCategory()).isEqualTo(MissionCategory.FOCUS);
        assertThat(focusResult.getDurationMinutes()).isEqualTo(30);
        assertThat(focusResult.getWindowStart()).isNull();
        assertThat(focusResult.getWindowEnd()).isNull();
        assertThat(focusResult.isCanParticipate()).isTrue(); // FOCUS 는 항상 참여 가능

        GroupChallengeResponse screenResult = result.get(1);
        assertThat(screenResult.getMissionType()).isEqualTo(MissionType.TIME_WINDOW);
        assertThat(screenResult.getWindowStart()).isEqualTo("09:00:00"); // UTC 기준 변환
        assertThat(screenResult.getWindowEnd()).isEqualTo("18:00:00");
        assertThat(screenResult.getDurationMinutes()).isNull(); // TIME_WINDOW 엔 duration 상세 없음
        assertThat(screenResult.isCanParticipate()).isFalse(); // SCREEN_TIME + 권한 미동의
    }

    @Test
    @DisplayName("게스트 유저 → GroupException(GUEST_FORBIDDEN)")
    void getChallengesGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest()));

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GUEST_FORBIDDEN);
    }

    @Test
    @DisplayName("멤버가 아님 → GroupException(MEMBER_ONLY)")
    void getChallengesNotMember() {
        // given: 유저·그룹은 존재하지만 멤버십 없음
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    // ── getChallenges: 멤버별 진행률(memberProgress) ────────────────────────

    /** 진행률 테스트 공통 셋업 — 멤버 2인(재영/수빈) 그룹에서 챌린지 하나를 조회한다. */
    private List<GroupMember> givenGroupWithTwoMembers(Group group, User user, GroupChallenge challenge) {
        User other = User.builder().id(OTHER_USER_ID).nickname("수빈").isGuest(false).build();
        List<GroupMember> members = List.of(
                groupMemberOf(user, group, GroupMemberRole.OWNER),
                groupMemberOf(other, group, GroupMemberRole.MEMBER));

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(members.get(0)));
        given(groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group))
                .willReturn(List.of(challenge));
        given(groupMemberRepository.findByGroup(group)).willReturn(members);
        return members;
    }

    private GroupChallenge durationChallenge(Group group, MissionCategory category) {
        return GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .type(MissionType.DURATION).category(category)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
    }

    private void givenDurationDetail(int durationMinutes) {
        given(groupChallengeDurationRepository.findByChallengeIdIn(List.of(CHALLENGE_ID)))
                .willReturn(List.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID)
                        .durationMinutes(durationMinutes)
                        .build()));
    }

    @Test
    @DisplayName("FOCUS/DURATION + date → 집중 분 집계, 통계 없는 멤버는 0분·미달성")
    void getChallengesFillsFocusProgress() {
        // given: 목표 60분 · 재영은 정확히 60분(경계) · 수빈은 통계 행 없음
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.FOCUS);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        given(dailyFocusStatRepository.findByUserInAndDate(
                members.stream().map(GroupMember::getUser).toList(), TODAY))
                .willReturn(List.of(DailyFocusStat.builder()
                        .user(user).date(TODAY).totalFocusSeconds(3600).build()));   // 60분

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: 목표와 같으면 달성(>=), 통계 없는 멤버는 0분·미달성 (null 아님)
        List<ChallengeMemberProgressResponse> progress = result.get(0).getMemberProgress();
        assertThat(progress).hasSize(2);
        assertThat(progress.get(0).getUserId()).isEqualTo(USER_ID);
        assertThat(progress.get(0).getNickname()).isEqualTo("재영");
        assertThat(progress.get(0).getProgressMinutes()).isEqualTo(60);
        assertThat(progress.get(0).getAchieved()).isTrue();
        assertThat(progress.get(1).getUserId()).isEqualTo(OTHER_USER_ID);
        assertThat(progress.get(1).getProgressMinutes()).isZero();
        assertThat(progress.get(1).getAchieved()).isFalse();
    }

    @Test
    @DisplayName("SCREEN_TIME/DURATION + date → 목표 이하면 달성, 통계 없는 멤버는 null(판정 불가)")
    void getChallengesFillsScreenTimeProgress() {
        // given: 목표 60분 · 재영은 50분 사용(달성) · 수빈은 통계 행 없음(판정 불가)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        given(dailyScreenTimeStatRepository.findByUserInAndDate(
                members.stream().map(GroupMember::getUser).toList(), TODAY))
                .willReturn(List.of(DailyScreenTimeStat.builder()
                        .user(user).date(TODAY).totalScreenTimeMinutes(50).build()));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: SCREEN_TIME 은 "적을수록 달성"(<=), 데이터 없음은 0분이 아니라 null 로 남긴다
        List<ChallengeMemberProgressResponse> progress = result.get(0).getMemberProgress();
        assertThat(progress).hasSize(2);
        assertThat(progress.get(0).getProgressMinutes()).isEqualTo(50);
        assertThat(progress.get(0).getAchieved()).isTrue();
        assertThat(progress.get(1).getProgressMinutes()).isNull();
        assertThat(progress.get(1).getAchieved()).isNull();
    }

    @Test
    @DisplayName("SCREEN_TIME 목표 초과 → achieved=false")
    void getChallengesScreenTimeOverGoalIsNotAchieved() {
        // given: 목표 60분인데 90분 사용
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        given(dailyScreenTimeStatRepository.findByUserInAndDate(
                members.stream().map(GroupMember::getUser).toList(), TODAY))
                .willReturn(List.of(DailyScreenTimeStat.builder()
                        .user(user).date(TODAY).totalScreenTimeMinutes(90).build()));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        ChallengeMemberProgressResponse mine = result.get(0).getMemberProgress().get(0);
        assertThat(mine.getProgressMinutes()).isEqualTo(90);
        assertThat(mine.getAchieved()).isFalse();
    }

    @Test
    @DisplayName("TIME_WINDOW 챌린지는 date 를 줘도 memberProgress = null (진행률 미지원)")
    void getChallengesTimeWindowHasNoProgress() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        givenGroupWithTwoMembers(group, user, challenge);

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: 진행률은 비우고, DURATION 챌린지가 없으니 통계도 조회하지 않는다
        assertThat(result.get(0).getMemberProgress()).isNull();
        verify(dailyFocusStatRepository, never()).findByUserInAndDate(any(), any());
        verify(dailyScreenTimeStatRepository, never()).findByUserInAndDate(any(), any());
    }

    @Test
    @DisplayName("date 없이 조회 → memberProgress = null, 멤버·통계 조회 자체를 하지 않는다")
    void getChallengesWithoutDateSkipsProgress() {
        // given: date 를 보내지 않는 기존 클라이언트
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.FOCUS);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        given(groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group))
                .willReturn(List.of(challenge));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, null);

        // then
        assertThat(result.get(0).getMemberProgress()).isNull();
        verify(groupMemberRepository, never()).findByGroup(group);
        verify(dailyFocusStatRepository, never()).findByUserInAndDate(any(), any());
        verify(dailyScreenTimeStatRepository, never()).findByUserInAndDate(any(), any());
    }

    // ── createChallenge ───────────────────────────────────────────────────

    @Test
    @DisplayName("DURATION 챌린지 생성 성공 → 저장 + 빈 비참여자 목록")
    void createDurationChallengeSuccess() {
        // given: OWNER + DURATION + durationMinutes>0 + FOCUS(비 SCREEN_TIME)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.DURATION);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getDurationMinutes()).willReturn(30);
        // 중복 체크(existsBy...AndStatus)는 stub 안 함 → 기본값 false

        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .type(MissionType.DURATION).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.save(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then: 챌린지 + DURATION 상세 저장, window 상세는 저장 안 함
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        assertThat(response.getNonParticipants()).isEmpty();
        verify(groupChallengeRepository).save(any(GroupChallenge.class));
        ArgumentCaptor<GroupChallengeDuration> durationCaptor = ArgumentCaptor.forClass(GroupChallengeDuration.class);
        verify(groupChallengeDurationRepository).save(durationCaptor.capture());
        assertThat(durationCaptor.getValue().getChallenge()).isEqualTo(saved);
        assertThat(durationCaptor.getValue().getDurationMinutes()).isEqualTo(30);
        verify(groupChallengeWindowRepository, never()).save(any(GroupChallengeWindow.class));
    }

    @Test
    @DisplayName("TIME_WINDOW 챌린지 생성 성공 → 챌린지 + window 상세 저장")
    void createTimeWindowChallengeSuccess() {
        // given: OWNER + TIME_WINDOW + start<end + FOCUS
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        Instant windowStart = Instant.parse("2026-01-01T00:00:00Z");
        Instant windowEnd = Instant.parse("2026-01-01T09:00:00Z");
        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getWindowStart()).willReturn(windowStart);
        given(request.getWindowEnd()).willReturn(windowEnd);

        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.save(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then: 챌린지 + TIME_WINDOW 상세 저장, duration 상세는 저장 안 함
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        verify(groupChallengeRepository).save(any(GroupChallenge.class));
        ArgumentCaptor<GroupChallengeWindow> windowCaptor = ArgumentCaptor.forClass(GroupChallengeWindow.class);
        verify(groupChallengeWindowRepository).save(windowCaptor.capture());
        assertThat(windowCaptor.getValue().getChallenge()).isEqualTo(saved);
        assertThat(windowCaptor.getValue().getWindowStartAt()).isEqualTo(windowStart);
        assertThat(windowCaptor.getValue().getWindowEndAt()).isEqualTo(windowEnd);
        verify(groupChallengeDurationRepository, never()).save(any(GroupChallengeDuration.class));
    }

    @Test
    @DisplayName("SCREEN_TIME 미션 생성 → 권한 미동의 멤버가 비참여자 목록에 포함")
    void createScreenTimeChallengeReturnsNonParticipants() {
        // given: SCREEN_TIME + 멤버 중 일부 isScreenTimePermissionGranted()=false
        User owner = member(); // screenTimePermissionGranted = false 지만 OWNER 본인
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group))
                .willReturn(Optional.of(groupMemberOf(owner, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.DURATION);
        given(request.getMissionCategory()).willReturn(MissionCategory.SCREEN_TIME);
        given(request.getDurationMinutes()).willReturn(30);

        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .type(MissionType.DURATION).category(MissionCategory.SCREEN_TIME)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.save(any(GroupChallenge.class))).willReturn(saved);

        UUID grantedId = UUID.fromString("00000000-0000-0000-0000-0000000000d1");
        UUID deniedId = UUID.fromString("00000000-0000-0000-0000-0000000000d2");
        User granted = User.builder().id(grantedId).nickname("동의함").build();
        User denied = User.builder().id(deniedId).nickname("미동의").build();
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(
                groupMemberOf(granted, group, GroupMemberRole.MEMBER),
                groupMemberOf(denied, group, GroupMemberRole.MEMBER)));
        given(userScreenTimeSettingsRepository.findAllById(any())).willReturn(List.of(
                settings(grantedId, true), settings(deniedId, false)));

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then: 권한 미동의 멤버만 비참여자로
        assertThat(response.getNonParticipants()).hasSize(1);
        assertThat(response.getNonParticipants().get(0).getUserId()).isEqualTo(deniedId);
        assertThat(response.getNonParticipants().get(0).getNickname()).isEqualTo("미동의");
    }

    @Test
    @DisplayName("게스트 유저 → GroupException(GUEST_FORBIDDEN)")
    void createChallengeGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest()));

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GUEST_FORBIDDEN);
    }

    @Test
    @DisplayName("OWNER 아님 → GroupException(NOT_OWNER)")
    void createChallengeNotOwner() {
        // given: 멤버지만 role != OWNER
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.MEMBER)));

        // when & then (NOT_OWNER 체크가 request 사용보다 앞서므로 request 는 null 로 충분)
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_OWNER);
    }

    @Test
    @DisplayName("DURATION 인데 durationMinutes 0 이하 → GroupException(INVALID_MISSION_PARAMS)")
    void createChallengeInvalidDuration() {
        // given: OWNER + DURATION + durationMinutes = 0
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.DURATION);
        given(request.getDurationMinutes()).willReturn(0);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
    }

    @Test
    @DisplayName("TIME_WINDOW 인데 파라미터 누락 → GroupException(INVALID_MISSION_PARAMS)")
    void createChallengeInvalidTimeWindow() {
        // given: OWNER + TIME_WINDOW + windowStart null (mock 기본값) → 파라미터 누락
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        // windowStart/End 는 stub 안 함 → null → 누락으로 간주

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
    }

    @Test
    @DisplayName("TIME_WINDOW 인데 windowEnd 가 windowStart 이후가 아님 → GroupException(INVALID_MISSION_PARAMS)")
    void createChallengeWindowEndNotAfterStart() {
        // given: OWNER + TIME_WINDOW + end == start
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        Instant sameInstant = Instant.parse("2026-01-01T09:00:00Z");
        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getWindowStart()).willReturn(sameInstant);
        given(request.getWindowEnd()).willReturn(sameInstant);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        verify(groupChallengeRepository, never()).save(any(GroupChallenge.class));
    }

    @Test
    @DisplayName("이미 활성 챌린지 존재 → GroupException(ACTIVE_CHALLENGE_EXISTS)")
    void createChallengeDuplicate() {
        // given: OWNER + DURATION + 동일 카테고리에 ACTIVE 챌린지 존재
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.DURATION);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getDurationMinutes()).willReturn(30);
        given(groupChallengeRepository.existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
                group, MissionCategory.FOCUS, MissionType.DURATION, GroupChallengeStatus.ACTIVE))
                .willReturn(true);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.ACTIVE_CHALLENGE_EXISTS);
        verify(groupChallengeRepository, never()).save(any(GroupChallenge.class));
    }

    @Test
    @DisplayName("TIME_WINDOW 겹치는 챌린지 존재 → GroupException(ACTIVE_CHALLENGE_EXISTS), 저장 안 함")
    void createChallengeOverlappingTimeWindow() {
        // given: OWNER + 유효한 새 윈도우 [10:00~11:00]
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        Instant newStart = Instant.parse("2026-01-01T10:00:00Z");
        Instant newEnd = Instant.parse("2026-01-01T11:00:00Z");
        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getWindowStart()).willReturn(newStart);
        given(request.getWindowEnd()).willReturn(newEnd);

        // 핵심: "겹치는 기존 챌린지가 있다"를 repository 스텁으로 표현 (실제 챌린지 객체 불필요).
        // 맞닿음(끝==시작) 같은 경계 판정 자체는 SQL 책임 → GroupChallengeWindowRepository 통합 테스트에서 검증.
        given(groupChallengeWindowRepository.existsOverlappingTimeWindow(
                group, MissionCategory.FOCUS, newStart, newEnd)).willReturn(true);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.ACTIVE_CHALLENGE_EXISTS);
        verify(groupChallengeRepository, never()).save(any(GroupChallenge.class));
        verify(groupChallengeWindowRepository, never()).save(any(GroupChallengeWindow.class));
    }

    // ── deleteChallenge ───────────────────────────────────────────────────

    @Test
    @DisplayName("챌린지 삭제 성공 → 하드 딜리트가 아니라 deletedAt 마킹")
    void deleteChallengeSuccess() {
        // given: OWNER + 해당 그룹의 챌린지 존재
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        GroupChallenge challenge = GroupChallenge.builder().id(CHALLENGE_ID).group(group).build();
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));

        // when
        groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID);

        // then: 행은 남고 deleted_at 만 채워진다 (CTI 상세 FK 보호 + 이력 보존)
        assertThat(challenge.getDeletedAt()).isNotNull();
        verify(groupChallengeRepository, never()).delete(any(GroupChallenge.class));
    }

    @Test
    @DisplayName("삭제 후 재생성 → 중복 검사가 삭제분을 제외하므로 같은 카테고리로 다시 만들 수 있다")
    void recreateAfterSoftDeleteIsAllowed() {
        // given: 방금 삭제한 것과 같은 FOCUS/DURATION 챌린지를 다시 생성.
        // 중복 검사는 deletedAt IS NULL 조건이 붙은 exists 라 삭제분이 잡히지 않는다(스텁 기본값 false).
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.DURATION);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getDurationMinutes()).willReturn(30);
        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .type(MissionType.DURATION).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.save(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then: ACTIVE_CHALLENGE_EXISTS 없이 새 챌린지가 저장된다
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        verify(groupChallengeRepository).existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
                group, MissionCategory.FOCUS, MissionType.DURATION, GroupChallengeStatus.ACTIVE);
    }

    @Test
    @DisplayName("OWNER 아님 → GroupException(NOT_OWNER)")
    void deleteChallengeNotOwner() {
        // given: 멤버지만 role != OWNER
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.MEMBER)));

        // when & then
        assertThatThrownBy(() -> groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_OWNER);
    }

    @Test
    @DisplayName("챌린지 없음 → GroupException(NOT_FOUND)")
    void deleteChallengeNotFound() {
        // given: OWNER 지만 챌린지 없음
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(CHALLENGE_ID, group))
                .willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }
}

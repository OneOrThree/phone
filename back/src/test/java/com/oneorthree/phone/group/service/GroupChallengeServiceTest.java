package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeMember;
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
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
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

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
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
 * windowStart/End 의 Instant→KST 벽시계 "HH:mm:ss" 변환(GROMO-1100).
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

    // 내기 조립은 GroupBetService 가 맡는다. Map 반환이라 스텁 없이도 빈 맵이 나와
    // (Mockito 기본값) 내기와 무관한 이 테스트들은 bet/lastSettledBet 을 null 로 본다.
    @Mock
    private GroupBetService groupBetService;

    // 삭제 가드(진행 중 내기 확인) 전용. 스텁이 없으면 false = "진행 중 내기 없음" 이라
    // 기존 삭제 테스트들은 그대로 통과한다.
    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;

    // 스크린타임 창 사용분 보고 원본 저장소 — 스텁이 없으면 빈 리스트 = "보고 없음"(판정 불가).
    @Mock
    private GroupChallengeMemberRepository groupChallengeMemberRepository;

    // FOCUS 창 클리핑 집계 — 스텁이 없으면 빈 맵 = "창 내 세션 없음"(0분). 달성 판정(isAchieved)은
    // static 실제 로직이라 관용치 경계가 이 테스트에서 그대로 검증된다.
    @Mock
    private WindowFocusAggregator windowFocusAggregator;

    // 챌린지 개설 알림(GROMO-1089) 이벤트 발행처. 발송은 알림 도메인이 AFTER_COMMIT 으로 받으므로
    // 여기서는 "무엇을 발행했는가" 만 검증한다.
    @Mock
    private ApplicationEventPublisher eventPublisher;

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
                        .windowStartAt(Instant.parse("2026-01-01T09:00:00+09:00")) // KST → 09:00:00
                        .windowEndAt(Instant.parse("2026-01-01T18:00:00+09:00"))   // KST → 18:00:00
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
        // GROMO-1100 회귀: 앱이 보낸 +09:00 Instant 가 KST 벽시계 그대로 "09:00:00" 으로 돌아와야 한다
        assertThat(screenResult.getWindowStart()).isEqualTo("09:00:00");
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

    /** 진행률 대상 필터가 보는 스크린타임 권한 — 전달한 유저만 동의(granted), 나머지는 미동의로 본다. */
    private void givenScreenTimePermission(UUID... grantedUserIds) {
        given(userScreenTimeSettingsRepository.findAllById(any())).willReturn(
                Arrays.stream(grantedUserIds).map(id -> settings(id, true)).toList());
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
        // given: 목표 60분 · 둘 다 권한 동의 · 재영은 50분 사용(달성) · 수빈은 통계 행 없음(판정 불가)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        givenScreenTimePermission(USER_ID, OTHER_USER_ID);
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
    @DisplayName("SCREEN_TIME 권한 미동의 멤버는 통계가 남아 있어도 진행률 null (비참여자와 동일 취급)")
    void getChallengesExcludesScreenTimeNonParticipants() {
        // given: 재영만 권한 동의 · 수빈은 권한 철회했지만 철회 전 통계 행(30분)이 남아 있음
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        givenScreenTimePermission(USER_ID);
        given(dailyScreenTimeStatRepository.findByUserInAndDate(List.of(user), TODAY))
                .willReturn(List.of(DailyScreenTimeStat.builder()
                        .user(user).date(TODAY).totalScreenTimeMinutes(50).build()));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: 조회 자체가 권한 동의 멤버로만 나가고, 미동의 멤버는 판정 불가(null)
        verify(dailyScreenTimeStatRepository).findByUserInAndDate(List.of(user), TODAY);
        List<ChallengeMemberProgressResponse> progress = result.get(0).getMemberProgress();
        assertThat(progress.get(0).getProgressMinutes()).isEqualTo(50);
        assertThat(progress.get(0).getAchieved()).isTrue();
        assertThat(progress.get(1).getUserId()).isEqualTo(OTHER_USER_ID);
        assertThat(progress.get(1).getProgressMinutes()).isNull();
        assertThat(progress.get(1).getAchieved()).isNull();
    }

    @Test
    @DisplayName("SCREEN_TIME 권한 동의 멤버가 없으면 통계 조회를 아예 하지 않는다")
    void getChallengesSkipsScreenTimeQueryWhenNoParticipant() {
        // given: 두 멤버 모두 권한 미동의
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        givenScreenTimePermission();

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        verify(dailyScreenTimeStatRepository, never()).findByUserInAndDate(any(), any());
        List<ChallengeMemberProgressResponse> progress = result.get(0).getMemberProgress();
        assertThat(progress).hasSize(2);
        assertThat(progress).allSatisfy(p -> {
            assertThat(p.getProgressMinutes()).isNull();
            assertThat(p.getAchieved()).isNull();
        });
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
        givenScreenTimePermission(USER_ID, OTHER_USER_ID);
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

    // ── myAchievedNow (내기 UI 표시값) ───────────────────────────────────
    // FOCUS 는 "확정 달성"(참가 가드 BET_ALREADY_ACHIEVED 의 근거), SCREEN_TIME 은 "잠정 달성"
    // (표시용 — 참가 차단은 반대 방향 BET_ALREADY_FAILED 가 한다)이라 의미가 다르다.

    /** loadCurrentBets 로 넘어간 myAchievedNow 맵을 캡처한다 — 내기 응답에 실릴 값 그대로다. */
    private Map<UUID, Boolean> capturedMyAchieved() {
        ArgumentCaptor<Map<UUID, Boolean>> captor = ArgumentCaptor.forClass(Map.class);
        verify(groupBetService).loadCurrentBets(any(), any(), any(), captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("SCREEN_TIME/DURATION — 사용분이 목표 이하면 myAchievedNow=true (잠정 달성)")
    void myAchievedNowIsProvisionalForScreenTimeDuration() {
        // given: 목표 60분 · 내 사용 50분 = 잠정 달성(하루가 끝나야 확정이라 뒤집힐 수 있다)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        givenScreenTimePermission(USER_ID, OTHER_USER_ID);
        given(dailyScreenTimeStatRepository.findByUserInAndDate(
                members.stream().map(GroupMember::getUser).toList(), TODAY))
                .willReturn(List.of(DailyScreenTimeStat.builder()
                        .user(user).date(TODAY).totalScreenTimeMinutes(50).build()));

        // when
        groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        assertThat(capturedMyAchieved()).containsEntry(CHALLENGE_ID, true);
    }

    @Test
    @DisplayName("SCREEN_TIME/DURATION — 목표를 초과했으면 myAchievedNow=false (참가 가드가 막을 상태)")
    void myAchievedNowIsFalseWhenScreenTimeOverGoal() {
        // given: 목표 60분인데 90분 사용 — 확정 패배라 참가는 BET_ALREADY_FAILED 로 막힌다
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        givenScreenTimePermission(USER_ID, OTHER_USER_ID);
        given(dailyScreenTimeStatRepository.findByUserInAndDate(
                members.stream().map(GroupMember::getUser).toList(), TODAY))
                .willReturn(List.of(DailyScreenTimeStat.builder()
                        .user(user).date(TODAY).totalScreenTimeMinutes(90).build()));

        // when
        groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        assertThat(capturedMyAchieved()).containsEntry(CHALLENGE_ID, false);
    }

    @Test
    @DisplayName("SCREEN_TIME — 미보고는 myAchievedNow=false. '0분 사용 = 달성' 으로 뒤집으면 안 된다")
    void myAchievedNowIsFalseWhenScreenTimeUnreported() {
        // given: 권한은 동의했지만 통계 행이 없다(미보고). FOCUS 였다면 "0분"이 사실이지만
        // 스크린타임에서 0 으로 접으면 "한 번도 안 썼으니 달성"이라는 거짓이 된다.
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.SCREEN_TIME);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        givenScreenTimePermission(USER_ID, OTHER_USER_ID);
        given(dailyScreenTimeStatRepository.findByUserInAndDate(
                members.stream().map(GroupMember::getUser).toList(), TODAY))
                .willReturn(List.of());

        // when
        groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        assertThat(capturedMyAchieved()).containsEntry(CHALLENGE_ID, false);
    }

    @Test
    @DisplayName("SCREEN_TIME/TIME_WINDOW — 창 보고값이 목표 이하면 myAchievedNow=true (경계 포함)")
    void myAchievedNowIsProvisionalForScreenTimeWindow() {
        // given: 창 목표 100분 · 내 보고 100분(경계) — 카드 진행률과 같은 소스·같은 규칙(<=)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.SCREEN_TIME);
        givenGroupWithTwoMembers(group, user, challenge);
        givenWindowDetail(100);
        given(groupChallengeMemberRepository.findByGroupChallengeIdInAndUsageDate(List.of(CHALLENGE_ID), TODAY))
                .willReturn(List.of(GroupChallengeMember.builder()
                        .groupChallenge(challenge).user(user).progressMinutes(100).usageDate(TODAY).build()));

        // when
        groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        assertThat(capturedMyAchieved()).containsEntry(CHALLENGE_ID, true);
    }

    @Test
    @DisplayName("SCREEN_TIME/TIME_WINDOW — 창 보고가 없으면(구 바이너리) myAchievedNow=false")
    void myAchievedNowIsFalseWhenWindowUsageUnreported() {
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.SCREEN_TIME);
        givenGroupWithTwoMembers(group, user, challenge);
        givenWindowDetail(100);
        given(groupChallengeMemberRepository.findByGroupChallengeIdInAndUsageDate(List.of(CHALLENGE_ID), TODAY))
                .willReturn(List.of());

        // when
        groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        assertThat(capturedMyAchieved()).containsEntry(CHALLENGE_ID, false);
    }

    @Test
    @DisplayName("FOCUS/DURATION 의 확정 달성 판정은 그대로다 — 회귀")
    void myAchievedNowStillConfirmedForFocusDuration() {
        // given: 목표 60분 · 내 집중 60분(경계 달성, >=)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = durationChallenge(group, MissionCategory.FOCUS);
        List<GroupMember> members = givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);
        given(dailyFocusStatRepository.findByUserInAndDate(
                members.stream().map(GroupMember::getUser).toList(), TODAY))
                .willReturn(List.of(DailyFocusStat.builder()
                        .user(user).date(TODAY).totalFocusSeconds(60 * 60).build()));

        // when
        groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        assertThat(capturedMyAchieved()).containsEntry(CHALLENGE_ID, true);
    }

    @Test
    @DisplayName("목표분 없는 구 창 챌린지는 myAchievedNow 자체를 채우지 않는다 — 내기 대상이 아니다")
    void myAchievedNowSkipsChallengeWithoutGoal() {
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.SCREEN_TIME);
        givenGroupWithTwoMembers(group, user, challenge);
        givenWindowDetail(null);

        // when
        groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        assertThat(capturedMyAchieved()).doesNotContainKey(CHALLENGE_ID);
    }

    @Test
    @DisplayName("창 상세 행이 유실된 TIME_WINDOW 챌린지는 date 를 줘도 memberProgress = null")
    void getChallengesTimeWindowHasNoProgress() {
        // given: window 상세가 조회되지 않는 창 챌린지(데이터 유실) — 목표를 모르니 판정 불가
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

    private GroupChallenge windowChallenge(Group group, MissionCategory category) {
        return GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .type(MissionType.TIME_WINDOW).category(category)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
    }

    /** 창 상세 스텁 — 09:00~12:00(KST) 창에 창 내 목표분(null 허용 = 목표 없는 구 창)을 얹는다. */
    private GroupChallengeWindow givenWindowDetail(Integer durationMinutes) {
        GroupChallengeWindow window = GroupChallengeWindow.builder()
                .challengeId(CHALLENGE_ID)
                .windowStartAt(Instant.parse("2026-01-01T09:00:00+09:00"))
                .windowEndAt(Instant.parse("2026-01-01T12:00:00+09:00"))
                .durationMinutes(durationMinutes)
                .build();
        given(groupChallengeWindowRepository.findByChallengeIdIn(List.of(CHALLENGE_ID)))
                .willReturn(List.of(window));
        return window;
    }

    @Test
    @DisplayName("FOCUS/TIME_WINDOW + 목표분 → 창 클리핑 실측 표시 + 달성 판정만 5분 관용치(목표−5 달성, 목표−6 미달성)")
    void getChallengesFillsWindowFocusProgressWithTolerance() {
        // given: 목표 60분 창 · 재영 55분(= 60−5, 경계 달성) · 수빈 54분(= 60−6, 미달성)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.FOCUS);
        givenGroupWithTwoMembers(group, user, challenge);
        GroupChallengeWindow window = givenWindowDetail(60);
        given(windowFocusAggregator.focusMinutesWithin(List.of(USER_ID, OTHER_USER_ID), TODAY, window))
                .willReturn(Map.of(USER_ID, 55, OTHER_USER_ID, 54));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: 표시값은 실측 그대로, 달성 플래그만 관용치 — durationMinutes 도 창 목표로 채워진다(additive)
        assertThat(result.get(0).getDurationMinutes()).isEqualTo(60);
        List<ChallengeMemberProgressResponse> progress = result.get(0).getMemberProgress();
        assertThat(progress).hasSize(2);
        assertThat(progress.get(0).getProgressMinutes()).isEqualTo(55);
        assertThat(progress.get(0).getAchieved()).isTrue();
        assertThat(progress.get(1).getProgressMinutes()).isEqualTo(54);
        assertThat(progress.get(1).getAchieved()).isFalse();
        // 일 통계는 조회하지 않는다(DURATION 대상 없음)
        verify(dailyFocusStatRepository, never()).findByUserInAndDate(any(), any());

        // myAchievedNow(내기 참가 판정)도 같은 소스·같은 관용치를 쓴다
        ArgumentCaptor<Map<UUID, Boolean>> achievedCaptor = ArgumentCaptor.forClass(Map.class);
        verify(groupBetService).loadCurrentBets(
                any(), any(), any(), achievedCaptor.capture());
        assertThat(achievedCaptor.getValue()).containsEntry(CHALLENGE_ID, true);
    }

    @Test
    @DisplayName("FOCUS/TIME_WINDOW — 창 내 세션이 없는 멤버는 0분·미달성 (서버 데이터라 0 이 사실)")
    void getChallengesWindowFocusDefaultsToZero() {
        // given: 목표 60분 창 · 아무도 창 내 세션 없음(집계 빈 맵)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.FOCUS);
        givenGroupWithTwoMembers(group, user, challenge);
        GroupChallengeWindow window = givenWindowDetail(60);
        given(windowFocusAggregator.focusMinutesWithin(List.of(USER_ID, OTHER_USER_ID), TODAY, window))
                .willReturn(Map.of());

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        List<ChallengeMemberProgressResponse> progress = result.get(0).getMemberProgress();
        assertThat(progress).allSatisfy(p -> {
            assertThat(p.getProgressMinutes()).isZero();
            assertThat(p.getAchieved()).isFalse();
        });
    }

    @Test
    @DisplayName("SCREEN_TIME/TIME_WINDOW + 목표분 → 보고값 ≤ 목표면 달성, 미보고 멤버는 null(판정 불가)")
    void getChallengesFillsWindowScreenTimeProgressFromReports() {
        // given: 목표 100분 창 · 재영 보고 100분(경계 달성) · 수빈 미보고
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.SCREEN_TIME);
        givenGroupWithTwoMembers(group, user, challenge);
        givenWindowDetail(100);
        given(groupChallengeMemberRepository.findByGroupChallengeIdInAndUsageDate(List.of(CHALLENGE_ID), TODAY))
                .willReturn(List.of(GroupChallengeMember.builder()
                        .groupChallenge(challenge)
                        .user(user)
                        .progressMinutes(100)
                        .usageDate(TODAY)
                        .build()));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: 보고값 기준(클라 신뢰), 미보고 = null — 구 바이너리 참가자의 정상 상태
        List<ChallengeMemberProgressResponse> progress = result.get(0).getMemberProgress();
        assertThat(progress.get(0).getProgressMinutes()).isEqualTo(100);
        assertThat(progress.get(0).getAchieved()).isTrue();
        assertThat(progress.get(1).getProgressMinutes()).isNull();
        assertThat(progress.get(1).getAchieved()).isNull();
        // 창형은 일별 스크린타임 통계와 무관하다
        verify(dailyScreenTimeStatRepository, never()).findByUserInAndDate(any(), any());
    }

    @Test
    @DisplayName("SCREEN_TIME/TIME_WINDOW 보고값이 목표 초과 → achieved=false")
    void getChallengesWindowScreenTimeOverGoalIsNotAchieved() {
        // given: 목표 100분 창인데 120분 보고
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.SCREEN_TIME);
        givenGroupWithTwoMembers(group, user, challenge);
        givenWindowDetail(100);
        given(groupChallengeMemberRepository.findByGroupChallengeIdInAndUsageDate(List.of(CHALLENGE_ID), TODAY))
                .willReturn(List.of(GroupChallengeMember.builder()
                        .groupChallenge(challenge)
                        .user(user)
                        .progressMinutes(120)
                        .usageDate(TODAY)
                        .build()));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then
        ChallengeMemberProgressResponse mine = result.get(0).getMemberProgress().get(0);
        assertThat(mine.getProgressMinutes()).isEqualTo(120);
        assertThat(mine.getAchieved()).isFalse();
    }

    @Test
    @DisplayName("목표분 없는 구 창 챌린지는 date 를 줘도 memberProgress = null (현행 유지, 판정 불가)")
    void getChallengesWindowWithoutGoalHasNoProgress() {
        // given: 창 상세는 있으나 duration_minutes = null (V20 이전 생성분)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = windowChallenge(group, MissionCategory.FOCUS);
        givenGroupWithTwoMembers(group, user, challenge);
        givenWindowDetail(null);

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: 진행률도 창 집계도 하지 않는다
        assertThat(result.get(0).getMemberProgress()).isNull();
        assertThat(result.get(0).getDurationMinutes()).isNull();
        verify(windowFocusAggregator, never()).focusMinutesWithin(any(), any(), any());
        verify(groupChallengeMemberRepository, never()).findByGroupChallengeIdInAndUsageDate(any(), any());
    }

    @Test
    @DisplayName("INACTIVE(종료된) 챌린지는 date 를 줘도 memberProgress = null, 통계도 조회하지 않는다")
    void getChallengesInactiveChallengeHasNoProgress() {
        // given: V2 마이그레이션이 레거시 ENDED 를 옮겨 둔 INACTIVE DURATION 챌린지
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .type(MissionType.DURATION).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.INACTIVE)
                .build();
        givenGroupWithTwoMembers(group, user, challenge);
        givenDurationDetail(60);

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, TODAY);

        // then: 끝난 챌린지에 당일 통계를 대조하면 과거 진행률이 매일 바뀌므로 계산 자체를 하지 않는다
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
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then: 챌린지 + DURATION 상세 저장, window 상세는 저장 안 함
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        assertThat(response.getNonParticipants()).isEmpty();
        verify(groupChallengeRepository).saveAndFlush(any(GroupChallenge.class));
        ArgumentCaptor<GroupChallengeDuration> durationCaptor = ArgumentCaptor.forClass(GroupChallengeDuration.class);
        verify(groupChallengeDurationRepository).save(durationCaptor.capture());
        assertThat(durationCaptor.getValue().getChallenge()).isEqualTo(saved);
        assertThat(durationCaptor.getValue().getDurationMinutes()).isEqualTo(30);
        verify(groupChallengeWindowRepository, never()).save(any(GroupChallengeWindow.class));
    }

    @Test
    @DisplayName("챌린지 생성 성공 → 개설 알림 이벤트를 (챌린지·그룹·개설자) 로 발행")
    void createChallengePublishesCreatedEvent() {
        // given: DURATION 생성 성공 경로와 동일
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
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class))).willReturn(saved);

        // when
        groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then: 발송이 아니라 이벤트만 — 실제 푸시는 커밋 이후 알림 도메인이 맡는다
        ArgumentCaptor<GroupChallengeCreatedEvent> eventCaptor =
                ArgumentCaptor.forClass(GroupChallengeCreatedEvent.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue()).isEqualTo(
                new GroupChallengeCreatedEvent(CHALLENGE_ID, GROUP_ID, USER_ID));
    }

    @Test
    @DisplayName("챌린지 생성 실패(중복) → 개설 알림 이벤트를 발행하지 않음")
    void createChallengeDoesNotPublishEventOnFailure() {
        // given: 같은 (카테고리, 타입) 활성 챌린지가 이미 있어 사전 검사에서 강하
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
                .isEqualTo(GroupErrorCode.CHALLENGE_DUPLICATE);
        verify(eventPublisher, never()).publishEvent(any(GroupChallengeCreatedEvent.class));
    }

    @Test
    @DisplayName("TIME_WINDOW 챌린지 생성 성공 → 챌린지 + window 상세(창 내 목표분 포함) 저장")
    void createTimeWindowChallengeSuccess() {
        // given: OWNER + TIME_WINDOW + start<end + FOCUS + 창 내 목표 120분(창 길이 540분 이내)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        Instant windowStart = Instant.parse("2026-01-01T00:00:00+09:00");
        Instant windowEnd = Instant.parse("2026-01-01T09:00:00+09:00");
        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getWindowStart()).willReturn(windowStart);
        given(request.getWindowEnd()).willReturn(windowEnd);
        given(request.getDurationMinutes()).willReturn(120);

        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then: 챌린지 + TIME_WINDOW 상세 저장, duration 상세는 저장 안 함
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        verify(groupChallengeRepository).saveAndFlush(any(GroupChallenge.class));
        ArgumentCaptor<GroupChallengeWindow> windowCaptor = ArgumentCaptor.forClass(GroupChallengeWindow.class);
        verify(groupChallengeWindowRepository).save(windowCaptor.capture());
        assertThat(windowCaptor.getValue().getChallenge()).isEqualTo(saved);
        assertThat(windowCaptor.getValue().getWindowStartAt()).isEqualTo(windowStart);
        assertThat(windowCaptor.getValue().getWindowEndAt()).isEqualTo(windowEnd);
        assertThat(windowCaptor.getValue().getDurationMinutes()).isEqualTo(120);
        verify(groupChallengeDurationRepository, never()).save(any(GroupChallengeDuration.class));
    }

    @Test
    @DisplayName("TIME_WINDOW 자정 걸침 창(22:00~01:00) → 창 길이 180분으로 계산돼 생성 허용")
    void createTimeWindowChallengeAllowsMidnightCrossing() {
        // given: 시각(time-of-day) 기준 시작 > 종료 — D 22:00 ~ D+1 01:00 창
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getWindowStart()).willReturn(Instant.parse("2026-01-01T22:00:00+09:00"));
        given(request.getWindowEnd()).willReturn(Instant.parse("2026-01-01T01:00:00+09:00"));
        given(request.getDurationMinutes()).willReturn(180);   // 정확히 창 길이 = 경계 허용

        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        verify(groupChallengeWindowRepository).save(any(GroupChallengeWindow.class));
    }

    @Test
    @DisplayName("TIME_WINDOW 인데 durationMinutes 누락 → GroupException(INVALID_MISSION_PARAMS)")
    void createTimeWindowChallengeRequiresDurationMinutes() {
        // given: 창 시각은 유효하지만 창 내 목표분이 없다
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getWindowStart()).willReturn(Instant.parse("2026-01-01T09:00:00+09:00"));
        given(request.getWindowEnd()).willReturn(Instant.parse("2026-01-01T12:00:00+09:00"));
        // durationMinutes 는 stub 안 함 → null

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        verify(groupChallengeRepository, never()).saveAndFlush(any(GroupChallenge.class));
    }

    @Test
    @DisplayName("TIME_WINDOW 인데 durationMinutes 가 창 길이 초과 → GroupException(INVALID_MISSION_PARAMS)")
    void createTimeWindowChallengeRejectsGoalOverWindowLength() {
        // given: 09:00~12:00 = 180분 창에 목표 181분
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getWindowStart()).willReturn(Instant.parse("2026-01-01T09:00:00+09:00"));
        given(request.getWindowEnd()).willReturn(Instant.parse("2026-01-01T12:00:00+09:00"));
        given(request.getDurationMinutes()).willReturn(181);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        verify(groupChallengeRepository, never()).saveAndFlush(any(GroupChallenge.class));
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
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class))).willReturn(saved);

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

        Instant sameInstant = Instant.parse("2026-01-01T09:00:00+09:00");
        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getWindowStart()).willReturn(sameInstant);
        given(request.getWindowEnd()).willReturn(sameInstant);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        verify(groupChallengeRepository, never()).saveAndFlush(any(GroupChallenge.class));
    }

    @Test
    @DisplayName("같은 (카테고리, 타입) 활성 챌린지 존재 → GroupException(CHALLENGE_DUPLICATE)")
    void createChallengeDuplicate() {
        // given: OWNER + DURATION + 동일 (카테고리, 타입)에 ACTIVE 챌린지 존재
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
                .isEqualTo(GroupErrorCode.CHALLENGE_DUPLICATE);
        verify(groupChallengeRepository, never()).saveAndFlush(any(GroupChallenge.class));
    }

    @Test
    @DisplayName("사전 검사를 통과했는데 저장이 유니크 위반 → 레이스로 보고 CHALLENGE_DUPLICATE 로 강하")
    void createChallengeMapsUniqueViolationToDuplicate() {
        // given: exists 는 false(스텁 기본값)인데 saveAndFlush 가 V20 부분 유니크 위반을 던진다
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
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class)))
                .willThrow(new DataIntegrityViolationException("uq_group_challenges_active_cat_type"));

        // when & then: check-then-insert 레이스의 패자도 같은 에러 코드를 받는다
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.CHALLENGE_DUPLICATE);
        verify(groupChallengeDurationRepository, never()).save(any(GroupChallengeDuration.class));
    }

    /** 겹침 검사 스텁 — 기존 활성 창형(카테고리·시각) 하나를 FOR UPDATE 조회 결과로 돌려준다. */
    private void givenActiveWindow(Group group, MissionCategory category, String start, String end) {
        GroupChallenge challenge = GroupChallenge.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-0000000000e1"))
                .group(group).type(MissionType.TIME_WINDOW).category(category)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        given(groupChallengeWindowRepository.findActiveByGroupForUpdate(group))
                .willReturn(List.of(GroupChallengeWindow.builder()
                        .challengeId(challenge.getId())
                        .challenge(challenge)
                        .windowStartAt(Instant.parse(start))
                        .windowEndAt(Instant.parse(end))
                        .build()));
    }

    private CreateChallengeRequest windowRequest(MissionCategory category, String start, String end, int goal) {
        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getMissionCategory()).willReturn(category);
        given(request.getWindowStart()).willReturn(Instant.parse(start));
        given(request.getWindowEnd()).willReturn(Instant.parse(end));
        given(request.getDurationMinutes()).willReturn(goal);
        return request;
    }

    @Test
    @DisplayName("다른 카테고리 활성 창형과 시각대 교차 → GroupException(CHALLENGE_WINDOW_OVERLAP), 저장 안 함")
    void createChallengeOverlappingTimeWindow() {
        // given: SCREEN_TIME 활성 창형 [09:00~12:00] 이 있는 그룹에 FOCUS 창형 [10:00~11:00] 생성 시도
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        givenActiveWindow(group, MissionCategory.SCREEN_TIME, "2026-01-01T09:00:00+09:00", "2026-01-01T12:00:00+09:00");

        CreateChallengeRequest request =
                windowRequest(MissionCategory.FOCUS, "2026-01-01T10:00:00+09:00", "2026-01-01T11:00:00+09:00", 30);

        // when & then: 같은 시간대 행동 하나로 내기 2개 중복 보상 차단
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.CHALLENGE_WINDOW_OVERLAP);
        verify(groupChallengeRepository, never()).saveAndFlush(any(GroupChallenge.class));
        verify(groupChallengeWindowRepository, never()).save(any(GroupChallengeWindow.class));
    }

    @Test
    @DisplayName("다른 카테고리 창형과 맞닿음(끝==시작)은 겹침이 아니다 → 생성 허용")
    void createChallengeAdjacentWindowIsAllowed() {
        // given: SCREEN_TIME [09:00~12:00] 뒤에 딱 붙는 FOCUS [12:00~13:00]
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        givenActiveWindow(group, MissionCategory.SCREEN_TIME, "2026-01-01T09:00:00+09:00", "2026-01-01T12:00:00+09:00");

        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class))).willReturn(saved);

        CreateChallengeRequest request =
                windowRequest(MissionCategory.FOCUS, "2026-01-01T12:00:00+09:00", "2026-01-01T13:00:00+09:00", 30);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
    }

    @Test
    @DisplayName("자정 걸침 창끼리의 교차도 하루 경계 전개로 잡는다 → CHALLENGE_WINDOW_OVERLAP")
    void createChallengeDetectsMidnightCrossingOverlap() {
        // given: SCREEN_TIME [23:00~02:00](자정 걸침) 이 있는데 FOCUS [01:00~03:00] 생성 시도 —
        // 새 창은 자정을 안 걸치지만 기존 창의 [00:00~02:00) 구간과 겹친다
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        givenActiveWindow(group, MissionCategory.SCREEN_TIME, "2026-01-01T23:00:00+09:00", "2026-01-01T02:00:00+09:00");

        CreateChallengeRequest request =
                windowRequest(MissionCategory.FOCUS, "2026-01-01T01:00:00+09:00", "2026-01-01T03:00:00+09:00", 30);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.CHALLENGE_WINDOW_OVERLAP);
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
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForUpdate(CHALLENGE_ID, group))
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
        given(groupChallengeRepository.saveAndFlush(any(GroupChallenge.class))).willReturn(saved);

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
    @DisplayName("진행 중(OPEN) 내기가 걸려 있으면 삭제 거절 → GroupException(CHALLENGE_HAS_OPEN_BET)")
    void deleteChallengeRejectedWhenOpenBetExists() {
        // given: OWNER + 챌린지 존재 + 그 챌린지에 오늘자 OPEN 내기
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        GroupChallenge challenge = GroupChallenge.builder().id(CHALLENGE_ID).group(group).build();
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForUpdate(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));
        given(groupChallengeBetRepository.existsByChallengeIdAndStatus(CHALLENGE_ID, GroupBetStatus.OPEN))
                .willReturn(true);

        // when & then: 판돈이 묶인 내기가 조회에서 사라지지 않도록 409 로 막는다
        assertThatThrownBy(() -> groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.CHALLENGE_HAS_OPEN_BET);
        assertThat(challenge.getDeletedAt()).isNull();
    }

    @Test
    @DisplayName("정산이 끝난 내기만 있으면 삭제 허용 — OPEN 이 아닌 이력은 삭제를 막지 않는다")
    void deleteChallengeAllowedWhenBetsAreSettled() {
        // given: OWNER + 챌린지 존재 + OPEN 내기 없음(정산 완료 이력만 있는 상태)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        GroupChallenge challenge = GroupChallenge.builder().id(CHALLENGE_ID).group(group).build();
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForUpdate(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));
        given(groupChallengeBetRepository.existsByChallengeIdAndStatus(CHALLENGE_ID, GroupBetStatus.OPEN))
                .willReturn(false);

        // when
        groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID);

        // then
        assertThat(challenge.getDeletedAt()).isNotNull();
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
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForUpdate(CHALLENGE_ID, group))
                .willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    // ── reportWindowUsage (스크린타임 창 사용분 보고) ────────────────────────

    /** 보고 성공 경로 공통 셋업 — 멤버 + SCREEN_TIME×TIME_WINDOW 챌린지. */
    private GroupChallenge givenReportableChallenge(User user, Group group, MissionCategory category,
            MissionType type) {
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.MEMBER)));
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .type(type).category(category)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));
        return challenge;
    }

    @Test
    @DisplayName("창 사용분 보고 성공 → (챌린지, 유저, 날짜) upsert — 서버 생성 id 로 저장 위임")
    void reportWindowUsageSuccess() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenReportableChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        WindowUsageReportRequest request =
                new WindowUsageReportRequest(TODAY, 90, Instant.parse("2026-08-01T12:30:00Z"));

        // when
        groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID, request);

        // then: 마지막 값 승리 upsert 로 위임된다 (id 는 서버가 UUID v7 생성)
        verify(groupChallengeMemberRepository)
                .upsertWindowUsage(any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(90));
    }

    @Test
    @DisplayName("usedMinutes 경계 — 0 과 1440 은 허용, 1441 은 INVALID_MISSION_PARAMS")
    void reportWindowUsageValidatesRange() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenReportableChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

        // when & then: 경계값은 통과
        groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 0, null));
        groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 1440, null));
        // 범위 밖(하루 초과)은 400
        assertThatThrownBy(() -> groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 1441, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        assertThatThrownBy(() -> groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, -1, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
    }

    @Test
    @DisplayName("SCREEN_TIME×TIME_WINDOW 가 아닌 챌린지에 보고 → INVALID_MISSION_PARAMS, 저장 안 함")
    void reportWindowUsageRejectsWrongChallengeKind() {
        // given: FOCUS DURATION 챌린지
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenReportableChallenge(user, group, MissionCategory.FOCUS, MissionType.DURATION);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt());
    }

    @Test
    @DisplayName("그룹원이 아니면 보고 불가 → MEMBER_ONLY")
    void reportWindowUsageMemberOnly() {
        // given: 멤버십 없음
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("게스트 보고 → GUEST_FORBIDDEN")
    void reportWindowUsageGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest()));

        // when & then
        assertThatThrownBy(() -> groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GUEST_FORBIDDEN);
    }

    @Test
    @DisplayName("삭제됐거나 없는 챌린지에 보고 → NOT_FOUND")
    void reportWindowUsageChallengeNotFound() {
        // given: 챌린지 조회가 비어 있다(soft delete 포함)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.MEMBER)));
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(CHALLENGE_ID, group))
                .willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }
}

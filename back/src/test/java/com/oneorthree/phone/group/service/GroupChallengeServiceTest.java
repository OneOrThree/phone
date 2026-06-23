package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
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
 * SCREEN_TIME 비참여자 목록, windowStart/End 의 Instant→"HH:mm:ss" 변환.
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

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");

    private User member() {
        return User.builder().id(USER_ID).nickname("재영").isGuest(false)
                .screenTimePermissionGranted(false).build();
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

        GroupChallenge focus = GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group)
                .missionType(MissionType.DURATION)
                .missionCategory(MissionCategory.FOCUS)
                .durationMinutes(30)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        GroupChallenge screenTime = GroupChallenge.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-0000000000c2"))
                .group(group)
                .missionType(MissionType.TIME_WINDOW)
                .missionCategory(MissionCategory.SCREEN_TIME)
                .windowStart(Instant.parse("2026-01-01T00:00:00Z")) // Asia/Seoul → 09:00:00
                .windowEnd(Instant.parse("2026-01-01T09:00:00Z"))   // Asia/Seoul → 18:00:00
                .timeZone("Asia/Seoul")
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        given(groupChallengeRepository.findByGroupOrderByCreatedAtDesc(group))
                .willReturn(List.of(focus, screenTime));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID);

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
        assertThat(screenResult.getWindowStart()).isEqualTo("09:00:00"); // timeZone 기준 변환
        assertThat(screenResult.getWindowEnd()).isEqualTo("18:00:00");
        assertThat(screenResult.getTimeZone()).isEqualTo("Asia/Seoul");
        assertThat(screenResult.isCanParticipate()).isFalse(); // SCREEN_TIME + 권한 미동의
    }

    @Test
    @DisplayName("게스트 유저 → GroupException(GUEST_FORBIDDEN)")
    void getChallengesGuestForbidden() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest()));

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID))
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
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
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
                .missionType(MissionType.DURATION).missionCategory(MissionCategory.FOCUS)
                .durationMinutes(30).status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.save(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        assertThat(response.getNonParticipants()).isEmpty();
        verify(groupChallengeRepository).save(any(GroupChallenge.class));
    }

    @Test
    @DisplayName("TIME_WINDOW 챌린지 생성 성공 → 저장")
    void createTimeWindowChallengeSuccess() {
        // given: OWNER + TIME_WINDOW + start<end + 유효 timeZone + FOCUS
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));

        CreateChallengeRequest request = mock(CreateChallengeRequest.class);
        given(request.getMissionType()).willReturn(MissionType.TIME_WINDOW);
        given(request.getMissionCategory()).willReturn(MissionCategory.FOCUS);
        given(request.getWindowStart()).willReturn(Instant.parse("2026-01-01T00:00:00Z"));
        given(request.getWindowEnd()).willReturn(Instant.parse("2026-01-01T09:00:00Z"));
        given(request.getTimeZone()).willReturn("Asia/Seoul");

        GroupChallenge saved = GroupChallenge.builder().id(CHALLENGE_ID).group(group)
                .missionType(MissionType.TIME_WINDOW).missionCategory(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.save(any(GroupChallenge.class))).willReturn(saved);

        // when
        CreateChallengeResponse response = groupChallengeService.createChallenge(GROUP_ID, USER_ID, request);

        // then
        assertThat(response.getId()).isEqualTo(CHALLENGE_ID);
        verify(groupChallengeRepository).save(any(GroupChallenge.class));
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
                .missionType(MissionType.DURATION).missionCategory(MissionCategory.SCREEN_TIME)
                .durationMinutes(30).status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.save(any(GroupChallenge.class))).willReturn(saved);

        UUID grantedId = UUID.fromString("00000000-0000-0000-0000-0000000000d1");
        UUID deniedId = UUID.fromString("00000000-0000-0000-0000-0000000000d2");
        User granted = User.builder().id(grantedId).nickname("동의함").screenTimePermissionGranted(true).build();
        User denied = User.builder().id(deniedId).nickname("미동의").screenTimePermissionGranted(false).build();
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(
                groupMemberOf(granted, group, GroupMemberRole.MEMBER),
                groupMemberOf(denied, group, GroupMemberRole.MEMBER)));

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
        // windowStart/End/timeZone 는 stub 안 함 → null → 누락으로 간주

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
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
        given(groupChallengeRepository.existsByGroupAndMissionCategoryAndMissionTypeAndStatus(
                group, MissionCategory.FOCUS, MissionType.DURATION, GroupChallengeStatus.ACTIVE))
                .willReturn(true);

        // when & then
        assertThatThrownBy(() -> groupChallengeService.createChallenge(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.ACTIVE_CHALLENGE_EXISTS);
        verify(groupChallengeRepository, never()).save(any(GroupChallenge.class));
    }

    // ── deleteChallenge ───────────────────────────────────────────────────

    @Test
    @DisplayName("챌린지 삭제 성공 → delete 호출")
    void deleteChallengeSuccess() {
        // given: OWNER + 해당 그룹의 챌린지 존재
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(groupMemberOf(user, group, GroupMemberRole.OWNER)));
        GroupChallenge challenge = GroupChallenge.builder().id(CHALLENGE_ID).group(group).build();
        given(groupChallengeRepository.findByIdAndGroup(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));

        // when
        groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID);

        // then
        verify(groupChallengeRepository).delete(challenge);
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
        given(groupChallengeRepository.findByIdAndGroup(CHALLENGE_ID, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.deleteChallenge(GROUP_ID, CHALLENGE_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }
}

package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
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
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 창 사용분 보고(GROMO-1407, N34·N43) 단위 테스트 — {@code GroupChallengeService} 에서 분리된
 * 종전 검증(범위·챌린지 종류·게스트·404)에 다음이 더해진다:
 * <ul>
 *   <li>measuredAt 미래(서버 +2분 초과) 거절 — {@code INVALID_MEASURED_AT} 400</li>
 *   <li>자격 확장(N43): 그룹 멤버가 아니어도 시작된 OPEN 회차 참가자면 보고 가능(탈퇴자 경로),
 *       둘 다 아니면 종전 계약 그대로 {@code MEMBER_ONLY}</li>
 *   <li>upsert 위임에 measuredAt 이 함께 전달된다(역전 무시의 실 SQL 검증은
 *       {@code GroupChallengeMemberRepositoryTest})</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class GroupBetWindowUsageServiceTest {

    @InjectMocks
    private GroupBetWindowUsageService groupBetWindowUsageService;

    @Mock
    private UserRepository userRepository;
    @Mock
    private GroupRepository groupRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private GroupChallengeRepository groupChallengeRepository;
    @Mock
    private GroupChallengeMemberRepository groupChallengeMemberRepository;
    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final LocalDate TODAY = LocalDate.of(2026, 8, 1);

    private User member() {
        return User.builder().id(USER_ID).nickname("재영").isGuest(false).build();
    }

    private User guest() {
        return User.builder().id(USER_ID).isGuest(true).build();
    }

    /** 성공 경로 공통 셋업 — 활성 유저 + 그룹 + 멤버십 + 지정 종류의 챌린지. */
    private GroupChallenge givenReportableChallenge(User user, Group group, MissionCategory category,
            MissionType type) {
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(GroupMember.builder()
                        .user(user).group(group).role(GroupMemberRole.MEMBER).build()));
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
    @DisplayName("보고 성공 → (챌린지, 유저, 날짜) upsert 에 measuredAt 이 함께 전달된다")
    void reportWindowUsageSuccess() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenReportableChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        Instant measuredAt = Instant.now().minusSeconds(60);
        WindowUsageReportRequest request = new WindowUsageReportRequest(TODAY, 90, measuredAt);

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID, request);

        // then: measured_at 단조 갱신 upsert 로 위임된다 (id 는 서버가 UUID v7 생성)
        verify(groupChallengeMemberRepository).upsertWindowUsage(
                any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(90), eq(measuredAt));
    }

    @Test
    @DisplayName("measuredAt 이 서버 시각 +2분 초과 → INVALID_MEASURED_AT, 저장 안 함(N34)")
    void reportWindowUsageRejectsFutureMeasuredAt() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenReportableChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

        // when & then: 관용치(2분)를 넘는 미래 시각은 거절 — 받아 주면 이후 정상 보고가 전부
        // "오래된 값"으로 버려져 낮은 사용분이 굳는다(스크린타임 오달성).
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, Instant.now().plusSeconds(180))))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MEASURED_AT);
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("measuredAt 이 관용치(+2분) 이내의 미래 → 허용(기기 시계 오차 수용)")
    void reportWindowUsageAllowsMeasuredAtWithinTolerance() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenReportableChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

        // when: 1분 미래 — 관용치 안이다
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, Instant.now().plusSeconds(60)));

        // then
        verify(groupChallengeMemberRepository)
                .upsertWindowUsage(any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(60), any());
    }

    @Test
    @DisplayName("멤버가 아니어도 시작된 OPEN 회차 참가자면 보고 가능(N43 — 탈퇴자 최종 보고 경로)")
    void reportWindowUsageAllowsOpenSessionParticipantWithoutMembership() {
        // given: 멤버십 없음 + 시작된 OPEN 회차 참가
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupChallengeBetSessionRepository.existsStartedOpenParticipation(
                eq(CHALLENGE_ID), eq(USER_ID), any(Instant.class))).willReturn(true);
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .type(MissionType.TIME_WINDOW).category(MissionCategory.SCREEN_TIME)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 30, Instant.now()));

        // then
        verify(groupChallengeMemberRepository)
                .upsertWindowUsage(any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(30), any());
    }

    @Test
    @DisplayName("멤버도 OPEN 회차 참가자도 아니면 → MEMBER_ONLY(종전 계약 유지)")
    void reportWindowUsageRejectsNonMemberNonParticipant() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupChallengeBetSessionRepository.existsStartedOpenParticipation(
                eq(CHALLENGE_ID), eq(USER_ID), any(Instant.class))).willReturn(false);

        // when & then
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("progressMinutes 경계 — 0 과 1440 은 허용, 범위 밖은 INVALID_MISSION_PARAMS")
    void reportWindowUsageValidatesRange() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenReportableChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

        // when & then: 경계값은 통과
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 0, null));
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 1440, null));
        // 범위 밖(하루 초과·음수)은 400
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 1441, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
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
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.INVALID_MISSION_PARAMS);
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("게스트 보고 → GUEST_FORBIDDEN")
    void reportWindowUsageGuestForbidden() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(guest()));

        // when & then
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(GroupMember.builder()
                        .user(user).group(group).role(GroupMemberRole.MEMBER).build()));
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(CHALLENGE_ID, group))
                .willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }
}

package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
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
 *   <li>자격의 <b>날짜 결속</b>(PR #573 codex ②): 대상 = {@code usageDate} 회차. 그 회차의
 *       참가자면 <b>시작됨 + OPEN</b> 일 때만 저장하고, 아니면 조용히 무시한다</li>
 *   <li>참가자 갈래는 대상 회차를 {@code FOR UPDATE} 로 잠근 뒤 저장한다(codex ① — 정산 직렬화)</li>
 *   <li>순수 멤버(그 날짜에 참가 행 없음)의 표시용 보고는 종전대로 통과(FR-9)</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class GroupBetWindowUsageServiceTest {

    @InjectMocks
    private GroupBetWindowUsageService groupBetWindowUsageService;

    @Mock
    private UserQueryService userQueryService;
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
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Mock
    private WindowFocusAggregator windowFocusAggregator;

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    /**
     * 어제 — 시각 게이트(미래 차단·오늘 창 시작)와 무관한 경로를 태우기 위한 값이다. 고정 리터럴이
     * 아니라 상대 날짜인 이유: 회차 없는 표시용 보고의 과거 허용 폭이
     * {@code DISPLAY_REPORT_LOOKBACK_DAYS}(=1) 일이라 고정 날짜는 시간이 지나면 게이트에 걸린다.
     */
    private static final LocalDate TODAY = LocalDate.now(KST).minusDays(1);

    private User member() {
        return User.builder().id(USER_ID).nickname("재영").isGuest(false).build();
    }

    private User guest() {
        return User.builder().id(USER_ID).isGuest(true).build();
    }

    /**
     * 성공 경로 공통 셋업 — 활성 유저 + 그룹 + 멤버십 + 지정 종류의 챌린지. 회차 조회는 스텁하지
     * 않는다(Mockito 기본값 {@code Optional.empty()}) = "그 날짜에 회차 없음" = 표시용 갈래.
     */
    private GroupChallenge givenMemberWithChallenge(User user, Group group, MissionCategory category,
            MissionType type) {
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(GroupMember.builder()
                        .user(user).group(group).role(GroupMemberRole.MEMBER).build()));
        return givenChallenge(group, category, type);
    }

    private GroupChallenge givenChallenge(Group group, MissionCategory category, MissionType type) {
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .type(type).category(category)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));
        return challenge;
    }

    private GroupChallengeBetSession session(GroupBetStatus status, Instant startsAt) {
        return GroupChallengeBetSession.builder()
                .id(SESSION_ID).sessionDate(TODAY).stake(30).goalMinutes(90)
                .missionCategory(MissionCategory.SCREEN_TIME).missionType(MissionType.TIME_WINDOW)
                .status(status)
                .startsAt(startsAt)
                .joinClosesAt(startsAt).closesAt(startsAt).settleAfter(startsAt)
                .build();
    }

    /** 대상 날짜에 내 참가 행이 있는 상태 — 돈이 걸린 갈래. 참가는 한참 전에 했다(기본값). */
    private void givenParticipantOn(GroupChallengeBetSession target) {
        givenParticipantOn(target, Instant.now().minusSeconds(7200));
    }

    /** 참가 시각을 지정하는 변형 — 참가 전 측정분 차단 검증용. */
    private void givenParticipantOn(GroupChallengeBetSession target, Instant joinedAt) {
        given(groupChallengeBetSessionRepository.findByChallengeIdAndSessionDate(CHALLENGE_ID, TODAY))
                .willReturn(Optional.of(target));
        given(groupChallengeBetParticipantRepository.findJoinedAtBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(Optional.of(joinedAt));
    }

    @Test
    @DisplayName("참가자 보고 성공 — 대상 회차를 잠그고(FOR UPDATE) upsert 에 measuredAt 이 전달된다")
    void participantReportLocksSessionAndPassesMeasuredAt() {
        // given: 시작된 OPEN 회차의 참가자
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, Instant.now().minusSeconds(3600));
        givenParticipantOn(started);
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(started));
        Instant measuredAt = Instant.now().minusSeconds(60);

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 90, measuredAt));

        // then: 잠금이 먼저, 그 다음 measured_at 단조 갱신 upsert
        verify(groupChallengeBetSessionRepository).findByIdForUpdate(SESSION_ID);
        verify(groupChallengeMemberRepository).upsertWindowUsage(
                any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(90), eq(measuredAt));
    }

    @Test
    @DisplayName("시작 전 회차(예약분)에 참가자가 보고 → 조용히 무시(선기록 차단 — codex ②)")
    void participantReportOnNotStartedSessionIsSkipped() {
        // given: join-week 로 예약만 된 미래 회차
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        GroupChallengeBetSession reserved =
                session(GroupBetStatus.OPEN, Instant.now().plusSeconds(48 * 3600));
        givenParticipantOn(reserved);
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(reserved));

        // when: 낮은 값을 미리 심으려는 보고
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 0, Instant.now()));

        // then: 예외 없이(204) 저장만 하지 않는다
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("정산이 끝난 회차에 참가자가 보고 → 잠금 후 재확인에서 조용히 무시(정산 불가역)")
    void participantReportOnSettledSessionIsSkipped() {
        // given: 잠금 대기 중 정산이 끝난 상태 — 잠금 이후 재조회가 SETTLED 를 본다
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        Instant startsAt = Instant.now().minusSeconds(7200);
        givenParticipantOn(session(GroupBetStatus.OPEN, startsAt));
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(session(GroupBetStatus.SETTLED, startsAt)));

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 10, Instant.now()));

        // then
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("그 날짜에 참가 행이 없는 순수 멤버의 표시용 보고는 회차 잠금 없이 통과(FR-9)")
    void memberDisplayReportPassesWithoutSessionLock() {
        // given: 회차 조회는 비어 있다(내기 꺼진 챌린지 = 회차 자체가 없다)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 40, Instant.now()));

        // then: 판정 대상이 아니므로 잠글 회차도 없다
        verify(groupChallengeBetSessionRepository, never()).findByIdForUpdate(any());
        verify(groupChallengeMemberRepository)
                .upsertWindowUsage(any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(40), any());
    }

    @Test
    @DisplayName("멤버가 아니어도 그 날짜 회차의 참가자면 보고 가능(N43 — 탈퇴자 최종 보고 경로)")
    void leaverParticipantReportsWithoutMembership() {
        // given: 멤버십 조회조차 하지 않는다(참가자 축으로 통과)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, Instant.now().minusSeconds(600));
        givenParticipantOn(started);
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(started));

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 30, Instant.now()));

        // then
        verify(groupMemberRepository, never()).findByUserAndGroup(any(), any());
        verify(groupChallengeMemberRepository)
                .upsertWindowUsage(any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(30), any());
    }

    @Test
    @DisplayName("멤버도, 그 날짜 회차의 참가자도 아니면 → MEMBER_ONLY(종전 계약 유지)")
    void reportRejectsNonMemberNonParticipant() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("measuredAt 이 서버 시각 +2분 초과 → INVALID_MEASURED_AT, 저장 안 함(N34)")
    void reportRejectsFutureMeasuredAt() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

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
    void reportAllowsMeasuredAtWithinTolerance() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

        // when: 1분 미래 — 관용치 안이다
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, Instant.now().plusSeconds(60)));

        // then
        verify(groupChallengeMemberRepository)
                .upsertWindowUsage(any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(60), any());
    }

    @Test
    @DisplayName("progressMinutes 경계 — 0 과 1440 은 허용, 범위 밖은 INVALID_MISSION_PARAMS")
    void reportValidatesRange() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

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
    void reportRejectsWrongChallengeKind() {
        // given: FOCUS DURATION 챌린지
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.FOCUS, MissionType.DURATION);

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
    @DisplayName("게스트 보고도 신원 가드에 걸리지 않는다 — 그룹 조회까지 진행 후 NOT_FOUND (GROMO-1509)")
    void reportAllowsGuest() {
        // 게스트가 내기엔 참가되는데 진행분 보고만 403 이면 자동 실패로 판돈만 잃는다 —
        // 그룹 도메인 게스트 차단 전면 해제(GROMO-1509)에 이 경로도 포함된 이유다.
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(guest());
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 60, null)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("삭제됐거나 없는 챌린지에 보고 → NOT_FOUND")
    void reportChallengeNotFound() {
        // given: 챌린지 조회가 비어 있다(soft delete 포함)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
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

    // ── 참가 전 측정분 차단 (지연 선기록 — 순차 경합) ─────────────────────────

    @Test
    @DisplayName("참가 전에 측정된 보고가 참가 뒤에 도착 → 조용히 무시(advisory lock 이 못 막는 순차 경합)")
    void participantReportMeasuredBeforeJoinIsSkipped() {
        // given: 창이 열린 뒤 미참가 시절(5분 전)에 잰 값 — 그 사이 참가가 먼저 커밋됐다(1분 전)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        givenParticipantOn(session(GroupBetStatus.OPEN, Instant.now().minusSeconds(3600)),
                Instant.now().minusSeconds(60));

        // when: 지연 도착한 낮은 선기록(SCREEN_TIME 은 작을수록 이긴다)
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 0, Instant.now().minusSeconds(300)));

        // then: 저장되지 않는다 — 회차를 잠글 것도 없이 측정 시각에서 걸린다
        verify(groupChallengeBetSessionRepository, never()).findByIdForUpdate(any());
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("참가 후에 측정된 보고는 정상 저장 — 차단은 참가 전 값만 겨눈다")
    void participantReportMeasuredAfterJoinIsStored() {
        // given: 5분 전 참가, 1분 전 측정
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, Instant.now().minusSeconds(3600));
        givenParticipantOn(started, Instant.now().minusSeconds(300));
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(started));
        Instant measuredAt = Instant.now().minusSeconds(60);

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 80, measuredAt));

        // then
        verify(groupChallengeMemberRepository).upsertWindowUsage(
                any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(80), eq(measuredAt));
    }

    @Test
    @DisplayName("참가자 갈래의 measuredAt 누락(구앱)은 조용히 무시 — 참가 전 값인지 판별할 수 없다")
    void participantReportWithoutMeasuredAtIsSkipped() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        givenParticipantOn(session(GroupBetStatus.OPEN, Instant.now().minusSeconds(3600)));

        // when: 시각 없는 보고 — 400 이 아니라 204 다(구앱에 고칠 수 없는 에러를 던지지 않는다)
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 0, null));

        // then
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("표시용 갈래는 measuredAt 이 없어도 그대로 저장 — 구앱 카드 진행률이 죽지 않는다(FR-9)")
    void displayReportWithoutMeasuredAtIsStored() {
        // given: 그 날짜에 회차가 없다(표시용 갈래)
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(TODAY, 35, null));

        // then
        verify(groupChallengeMemberRepository).upsertWindowUsage(
                any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(TODAY), eq(35), eq(null));
    }

    // ── 회차에 기대지 않는 시각 게이트 (PR #573 codex ①) ─────────────────────

    @Test
    @DisplayName("회차가 없어도 미래 날짜 보고는 무시 — 개설 전 선기록 차단(createBet 이 나중에 회차를 만든다)")
    void futureDateReportIsIgnoredWithoutSession() {
        // given: 그 날짜에 회차가 아직 없다(Mockito 기본 Optional.empty())
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        LocalDate future = LocalDate.now(KST).plusDays(2);

        // when: 미래 날짜에 0분을 미리 심으려는 보고
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(future, 0, Instant.now()));

        // then: 예외 없이(204) 저장만 하지 않는다 — 회차 게이트는 행이 없어 작동하지 못하는 자리다
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("오늘이라도 창 시작 전이면 무시 — 회차 없이 챌린지 창 시각만으로 판정한다")
    void todayReportBeforeWindowStartIsIgnored() {
        // given: 오늘 창이 아직 열리지 않았다
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        LocalDate today = LocalDate.now(KST);
        GroupChallengeWindow window = GroupChallengeWindow.builder().challengeId(CHALLENGE_ID).build();
        given(groupChallengeWindowRepository.findById(CHALLENGE_ID)).willReturn(Optional.of(window));
        given(windowFocusAggregator.windowStartOn(today, window))
                .willReturn(Instant.now().plusSeconds(3600));

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(today, 0, Instant.now()));

        // then
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("회차 없는 날짜의 오래된 과거 보고는 무시 — 임의 과거 날짜 대량 전송으로 행을 불릴 수 없다")
    void staleDateDisplayReportIsIgnoredWithoutSession() {
        // given: 회차가 없는(내기 꺼진) 챌린지에 한참 전 날짜를 밀어 넣는다
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        LocalDate stale = LocalDate.now(KST).minusDays(30);

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(stale, 0, Instant.now()));

        // then: 표시할 곳도 없고 판정 대상도 아닌 행이라 만들지 않는다
        verify(groupChallengeMemberRepository, never())
                .upsertWindowUsage(any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("어제분 표시용 보고는 통과 — 자정 직후 늦은 보고를 막지 않는다(FR-9)")
    void yesterdayDisplayReportIsStored() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(yesterday, 45, Instant.now()));

        // then
        verify(groupChallengeMemberRepository).upsertWindowUsage(
                any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(yesterday), eq(45), any());
    }

    @Test
    @DisplayName("회차가 있는 오래된 날짜는 제한하지 않는다 — 날짜가 서버가 만든 회차에 결속돼 유한하다")
    void staleDateReportIsAllowedWhenSessionExists() {
        // given: 30일 전 날짜에 시작된 OPEN 회차가 있고 나는 그 회차 참가자다
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        givenChallenge(group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        LocalDate stale = LocalDate.now(KST).minusDays(30);
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, Instant.now().minusSeconds(3600));
        given(groupChallengeBetSessionRepository.findByChallengeIdAndSessionDate(CHALLENGE_ID, stale))
                .willReturn(Optional.of(started));
        given(groupChallengeBetParticipantRepository.findJoinedAtBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(Optional.of(Instant.now().minusSeconds(7200)));
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(started));

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(stale, 60, Instant.now()));

        // then
        verify(groupChallengeMemberRepository).upsertWindowUsage(
                any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(stale), eq(60), any());
    }

    @Test
    @DisplayName("오늘 창이 이미 시작됐으면 저장 — 시각 게이트가 정상 보고를 막지 않는다")
    void todayReportAfterWindowStartIsStored() {
        // given
        User user = member();
        Group group = Group.builder().id(GROUP_ID).build();
        givenMemberWithChallenge(user, group, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        LocalDate today = LocalDate.now(KST);
        GroupChallengeWindow window = GroupChallengeWindow.builder().challengeId(CHALLENGE_ID).build();
        given(groupChallengeWindowRepository.findById(CHALLENGE_ID)).willReturn(Optional.of(window));
        given(windowFocusAggregator.windowStartOn(today, window))
                .willReturn(Instant.now().minusSeconds(3600));

        // when
        groupBetWindowUsageService.reportWindowUsage(GROUP_ID, CHALLENGE_ID, USER_ID,
                new WindowUsageReportRequest(today, 25, Instant.now()));

        // then
        verify(groupChallengeMemberRepository)
                .upsertWindowUsage(any(UUID.class), eq(CHALLENGE_ID), eq(USER_ID), eq(today), eq(25), any());
    }
}

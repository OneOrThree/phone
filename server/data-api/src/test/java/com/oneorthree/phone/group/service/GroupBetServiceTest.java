package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.domain.RepeatSchedule;
import com.oneorthree.phone.group.dto.ChallengeMemberProgressResponse;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetConfigResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.dto.GroupBetResultParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResultResponse;
import com.oneorthree.phone.group.dto.GroupBetSessionParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetSessionResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 내기 개설(브리지)·참가·철회 가드 단위 테스트 — 2계층 재편(GROMO-1262) 기준.
 *
 * <p>돈이 걸리는 경로라 "거절되어야 할 때 확실히 거절되는가"가 핵심이다 — 목표 없는 챌린지,
 * 허용 참가비(1~3000, GROMO-1264), 오늘 날짜, 창 마감, 중복 개설/참가, 카테고리별 참가 가드
 * (FOCUS 이미 달성 / SCREEN_TIME 이미 초과), 잔액 부족. 거절 시 <b>참가비가 차감되지 않는지</b>까지
 * 함께 본다.
 *
 * <p>분배 규칙은 {@link GroupBetPayoutCalculatorTest}, 정산 멱등은
 * {@code GroupBetSettlementIntegrationTest} 가 맡는다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetServiceTest {

    @InjectMocks
    private GroupBetService groupBetService;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private GroupChallengeRepository groupChallengeRepository;

    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;

    @Mock
    private CurrencyLedgerService currencyLedgerService;

    /**
     * 조합별 판정 소스는 {@link GroupBetJudge} 가 쥔다 — 여기서는 그 결과를 받아 <b>어떤 가드로
     * 갈라지는지</b>만 본다. {@code isAchieved} 는 정적 순수 함수라 스텁 없이 실제 규칙이 돈다.
     */
    @Mock
    private GroupBetJudge groupBetJudge;

    /** 순수 조립 컴포넌트 — 실제 인스턴스로 스냅샷 박제 값(창 시각·마감·정산 시각)까지 그대로 검증한다. */
    @Spy
    private GroupBetSessionFactory groupBetSessionFactory = new GroupBetSessionFactory();

    /**
     * 참가 시 선기록 무효화(GROMO-1407)의 위임처 — 참가 행 생성과 <b>같은 트랜잭션</b>에서 그
     * (챌린지, 유저, 회차 날짜)의 기존 창 사용분 보고를 지운다. 여기서는 배선만 본다(무효화 자체의
     * 동작은 {@code GroupBetWindowUsageIntegrationTest}).
     */
    @Mock
    private GroupBetWindowUsageService groupBetWindowUsageService;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID CONFIG_ID = UUID.fromString("00000000-0000-0000-0000-0000000000d1");
    /** 회차 id — 구 API 경로의 betId 가 이 값으로 해석된다(N36 브리지). */
    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-0000000000b1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    /** 참가 행 id — 돈 흐름 멱등키의 단일 축(FR-42)이라 단위 테스트에서도 실제 값이 필요하다. */
    private static final UUID PARTICIPANT_ID = UUID.fromString("00000000-0000-0000-0000-0000000000e1");
    private static final UUID OTHER_PARTICIPANT_ID =
            UUID.fromString("00000000-0000-0000-0000-0000000000e2");

    private static final int GOAL_MINUTES = 120;

    /** 참가 경로 공통 스텁 — 거절 경로에는 도달하지 않는 스텁이라 lenient 로 둔다. */
    @BeforeEach
    void givenStakeInSucceeds() {
        lenient().when(groupChallengeBetParticipantRepository.save(any()))
                .thenReturn(GroupChallengeBetParticipant.builder().id(PARTICIPANT_ID).build());
        lenient().when(currencyLedgerService.debit(any(), any(), anyInt(), anyString()))
                .thenReturn(true);
    }

    /** 서비스가 보는 "오늘"과 같은 기준(KST). */
    private LocalDate today() {
        return LocalDate.now(KST);
    }

    private User member() {
        return User.builder().id(USER_ID).nickname("재영").isGuest(false).build();
    }

    private User guest() {
        return User.builder().id(USER_ID).nickname("게스트").isGuest(true).build();
    }

    private Group group() {
        return Group.builder().id(GROUP_ID).name("스터디").build();
    }

    private GroupChallenge challenge(MissionCategory category, MissionType type) {
        return GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group())
                .category(category)
                .type(type)
                .build();
    }

    private GroupChallenge focusChallenge() {
        return challenge(MissionCategory.FOCUS, MissionType.DURATION);
    }

    /** 요일 집합을 지정한 하루형 FOCUS 챌린지 — 활성 요일 판정(§A3)의 원값을 실제로 싣는다. */
    private GroupChallenge challengeRepeating(int repeatDaysMask) {
        return GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group())
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .repeatDays(repeatDaysMask)
                .build();
    }

    /**
     * 요청 DTO 는 값 운반체일 뿐 상호작용을 단언하는 협력자가 아니다. 이른 거절 경로에서는 stake 만
     * 읽고 끝나기도 하므로 lenient 로 둔다.
     */
    private CreateBetRequest request(int stake, LocalDate date) {
        CreateBetRequest request = mock(CreateBetRequest.class);
        lenient().when(request.getStake()).thenReturn(stake);
        lenient().when(request.getDate()).thenReturn(date);
        return request;
    }

    /**
     * 유저·그룹원 검증까지 통과하는 공통 스텁 — 유저 로드는 공유 락(GROMO-801), 돈이 움직이는
     * 경로의 멤버십도 공유 락 조회(N54 — 그룹 탈퇴와 직렬화)다. 조회 경로는 무락 조회를 쓴다.
     */
    private User givenMember() {
        User user = member();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group()));
        GroupMember membership = GroupMember.builder()
                .user(user).group(group()).role(GroupMemberRole.MEMBER).build();
        lenient().when(groupMemberRepository.findActiveByUserIdAndGroupIdForShare(USER_ID, GROUP_ID))
                .thenReturn(Optional.of(membership));
        lenient().when(groupMemberRepository.findByUserAndGroup(any(), any()))
                .thenReturn(Optional.of(membership));
        return user;
    }

    private void givenChallenge(GroupChallenge challenge) {
        // 개설은 챌린지 행을 잠그고 읽는다(삭제·동시 개설과 직렬화) — 스텁도 락 조회 쪽에 건다.
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForUpdate(eq(CHALLENGE_ID), any()))
                .willReturn(Optional.of(challenge));
    }

    /** 일 목표(DURATION) 대상. 카테고리만 갈아끼워 4조합의 절반을 만든다. */
    private GroupBetJudge.Target durationTarget(MissionCategory category) {
        return new GroupBetJudge.Target(CHALLENGE_ID, category, MissionType.DURATION,
                GOAL_MINUTES, null, null);
    }

    /** 창 목표(TIME_WINDOW) 대상 — 창 시각은 스냅샷 박제 검증에 쓰인다(09:00~12:00 KST). */
    private GroupBetJudge.Target windowTarget(MissionCategory category) {
        // V35(GROMO-1406) 이후 창 시각은 KST 벽시계 값 그 자체다 — 판정 대상도 CTI 엔티티가 아니라
        // 회차 스냅샷과 같은 값(LocalTime)을 든다(GROMO-1280).
        return new GroupBetJudge.Target(CHALLENGE_ID, category, MissionType.TIME_WINDOW,
                GOAL_MINUTES, LocalTime.parse("09:00"), LocalTime.parse("12:00"));
    }

    /**
     * 판정 소스 스텁 — 대상 해석 + 창 마감 시각 + 내 진행분. 개설은 살아 있는 챌린지에서
     * ({@code resolve}), 참가는 회차 스냅샷에서({@code ofSession}) 같은 대상을 얻는다(GROMO-1280).
     *
     * @param closesAt 창 마감(창형만). null 이면 DURATION 처럼 마감 검사가 없다
     * @param minutes  내 진행분. null 이면 데이터 없음(FOCUS=0분, SCREEN_TIME=미계측)
     */
    private void givenTarget(GroupBetJudge.Target target, Instant closesAt, Integer minutes) {
        lenient().when(groupBetJudge.resolve(any())).thenReturn(Optional.of(target));
        lenient().when(groupBetJudge.ofSession(any())).thenReturn(Optional.of(target));
        lenient().when(groupBetJudge.windowClosesAt(eq(target), any()))
                .thenReturn(Optional.ofNullable(closesAt));
        lenient().when(groupBetJudge.progressMinutes(eq(target), any(), any()))
                .thenReturn(minutes == null ? Map.of() : Map.of(USER_ID, minutes));
    }

    /** 기본 조합(FOCUS × DURATION) + 내 집중 분. */
    private GroupBetJudge.Target givenFocusDuration(Integer myFocusMinutes) {
        GroupBetJudge.Target target = durationTarget(MissionCategory.FOCUS);
        givenTarget(target, null, myFocusMinutes);
        return target;
    }

    /** 아직 안 끝난 창. */
    private Instant oneHourLater() {
        return Instant.now().plus(1, ChronoUnit.HOURS);
    }

    /** 이미 끝난 창. */
    private Instant oneHourAgo() {
        return Instant.now().minus(1, ChronoUnit.HOURS);
    }

    private GroupChallengeBet config() {
        return GroupChallengeBet.builder()
                .id(CONFIG_ID)
                .group(group())
                .challenge(focusChallenge())
                .stake(30)
                .enabled(true)
                .build();
    }

    /** 회차 픽스처 — 하루형 기본(시작 = 회차일 00:00 KST). */
    private GroupChallengeBetSession session(GroupBetStatus status, LocalDate sessionDate) {
        return session(status, sessionDate, sessionDate.atStartOfDay(KST).toInstant());
    }

    private GroupChallengeBetSession session(GroupBetStatus status, LocalDate sessionDate, Instant startsAt) {
        Instant closesAt = sessionDate.plusDays(1).atStartOfDay(KST).toInstant();
        return GroupChallengeBetSession.builder()
                .id(SESSION_ID)
                .bet(config())
                .group(group())
                .challenge(focusChallenge())
                .sessionDate(sessionDate)
                .stake(30)
                .goalMinutes(GOAL_MINUTES)
                .missionCategory(MissionCategory.FOCUS)
                .missionType(MissionType.DURATION)
                .status(status)
                .startsAt(startsAt)
                .joinClosesAt(closesAt)
                .closesAt(closesAt)
                .settleAfter(closesAt)
                .build();
    }

    /** 개설 브리지 공통 스텁 — 설정 없음(신규 생성) + 해당 날짜 회차 없음. */
    private void givenNoConfigAndNoSession(LocalDate sessionDate) {
        given(groupChallengeBetRepository.findByChallengeId(CHALLENGE_ID)).willReturn(Optional.empty());
        given(groupChallengeBetRepository.saveAndFlush(any())).willReturn(config());
        given(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(CONFIG_ID, sessionDate))
                .willReturn(Optional.empty());
        given(groupChallengeBetSessionRepository.saveAndFlush(any()))
                .willAnswer(invocation -> invocation.getArgument(0, GroupChallengeBetSession.class));
    }

    /** 판돈이 한 푼도 움직이지 않았음을 단언한다 — 거절 경로의 필수 조건. */
    private void assertNoStakeCharged() {
        verify(currencyLedgerService, never()).debit(any(), any(), anyInt(), anyString());
        verify(groupChallengeBetParticipantRepository, never()).save(any());
    }

    // ── 개설 (레거시 브리지) ─────────────────────────────────────────────

    @Test
    @DisplayName("개설 성공 → 설정 생성 + 회차 개설(스냅샷 박제) + 본인 참가 + 차감(멱등키 session:{sid}:stake:{pid})")
    void createBetChargesStakeAndAutoJoinsOpener() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        givenNoConfigAndNoSession(today());

        CreateBetResponse response =
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today()));

        // 응답의 betId = 회차 id (브리지) — 저장 스텁이 인자를 그대로 돌려주므로 id 는 null 이다.
        // 여기서는 회차 저장·스냅샷 박제·차감 키만 본다.
        assertThat(response).isNotNull();

        ArgumentCaptor<GroupChallengeBetSession> savedSession =
                ArgumentCaptor.forClass(GroupChallengeBetSession.class);
        verify(groupChallengeBetSessionRepository).saveAndFlush(savedSession.capture());
        GroupChallengeBetSession session = savedSession.getValue();
        // 미션 스냅샷 박제(GROMO-1263) — 카테고리·방식·목표분·참가비.
        assertThat(session.getMissionCategory()).isEqualTo(MissionCategory.FOCUS);
        assertThat(session.getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(session.getGoalMinutes()).isEqualTo(GOAL_MINUTES);
        assertThat(session.getStake()).isEqualTo(30);
        assertThat(session.getSessionDate()).isEqualTo(today());
        // 하루형 시각 박제 — 회차일 00:00 ~ 익일 00:00 (KST).
        assertThat(session.getStartsAt()).isEqualTo(today().atStartOfDay(KST).toInstant());
        assertThat(session.getClosesAt())
                .isEqualTo(today().plusDays(1).atStartOfDay(KST).toInstant());

        ArgumentCaptor<GroupChallengeBetParticipant> participant =
                ArgumentCaptor.forClass(GroupChallengeBetParticipant.class);
        verify(groupChallengeBetParticipantRepository).save(participant.capture());
        assertThat(participant.getValue().getUser().getId()).isEqualTo(USER_ID);
        // 정산 전이므로 판정 결과는 비어 있어야 한다(null = 아직 판정 안 됨).
        assertThat(participant.getValue().getAchieved()).isNull();
        assertThat(participant.getValue().getPayout()).isNull();

        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), key.capture());
        // 축은 유저가 아니라 참가 행이다(FR-42) — 철회 후 재참여가 같은 키를 만들면 참가비 0원
        // 참가가 성립한다(GROMO-1112).
        assertThat(key.getValue()).endsWith(":stake:" + PARTICIPANT_ID);
    }

    @Test
    @DisplayName("창형 개설 — 창 시각(KST 벽시계)이 회차에 박제된다 (GROMO-1263)")
    void createBetSnapshotsWindowTimes() {
        givenMember();
        givenChallenge(challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW));
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourLater(), 0);
        givenNoConfigAndNoSession(today());

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today()));

        ArgumentCaptor<GroupChallengeBetSession> savedSession =
                ArgumentCaptor.forClass(GroupChallengeBetSession.class);
        verify(groupChallengeBetSessionRepository).saveAndFlush(savedSession.capture());
        GroupChallengeBetSession session = savedSession.getValue();
        assertThat(session.getWindowStart()).isEqualTo(LocalTime.of(9, 0));
        assertThat(session.getWindowEnd()).isEqualTo(LocalTime.of(12, 0));
        // 창형 시작 = 창 시작(KST) — 참가 취소(시작 전) 판정의 축.
        assertThat(session.getStartsAt())
                .isEqualTo(today().atTime(9, 0).atZone(KST).toInstant());
        assertThat(session.getClosesAt())
                .isEqualTo(today().atTime(12, 0).atZone(KST).toInstant());
        // 창형 참가 마감 스냅샷 = 창 시작(LLD §1.1 — 강제는 B4).
        assertThat(session.getJoinClosesAt()).isEqualTo(session.getStartsAt());
    }

    @Test
    @DisplayName("설정이 이미 있으면 재사용 + stake 갱신(브리지) — 회차만 새로 열린다")
    void createBetReusesExistingConfigAndUpdatesStake() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        GroupChallengeBet existing = config();
        given(groupChallengeBetRepository.findByChallengeId(CHALLENGE_ID))
                .willReturn(Optional.of(existing));
        given(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(CONFIG_ID, today()))
                .willReturn(Optional.empty());
        given(groupChallengeBetSessionRepository.saveAndFlush(any()))
                .willAnswer(invocation -> invocation.getArgument(0, GroupChallengeBetSession.class));

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(500, today()));

        // 설정 신규 저장은 없다 — 기존 행 재사용 + stake 만 최신 선택값으로.
        verify(groupChallengeBetRepository, never()).saveAndFlush(any());
        assertThat(existing.getStake()).isEqualTo(500);
        // 새 회차는 갱신된 stake 를 박제한다.
        ArgumentCaptor<GroupChallengeBetSession> savedSession =
                ArgumentCaptor.forClass(GroupChallengeBetSession.class);
        verify(groupChallengeBetSessionRepository).saveAndFlush(savedSession.capture());
        assertThat(savedSession.getValue().getStake()).isEqualTo(500);
    }

    @Test
    @DisplayName("참가비 범위(1~3000) 밖 — 0·3001·음수 → BET_INVALID_STAKE, 차감 없음 (GROMO-1264)")
    void createBetRejectsStakeOutOfRange() {
        givenMember();

        for (int stake : new int[] {0, 3001, -10}) {
            assertThatThrownBy(() ->
                    groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(stake, today())))
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_INVALID_STAKE);
        }
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("참가비 경계값 1·3000 은 허용 — 프리셋은 앱 몫, 서버는 범위만 본다(N30)")
    void createBetAllowsStakeBoundaries() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        givenNoConfigAndNoSession(today());

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(1, today()));
        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(3000, today()));

        ArgumentCaptor<GroupChallengeBet> saved = ArgumentCaptor.forClass(GroupChallengeBet.class);
        verify(groupChallengeBetRepository, times(2)).saveAndFlush(saved.capture());
        assertThat(saved.getAllValues())
                .extracting(GroupChallengeBet::getStake)
                .containsExactly(1, 3000);
    }

    @Test
    @DisplayName("지난 날짜 → BET_CLOSED — 결과가 이미 정해진 판에는 걸 수 없다")
    void createBetRejectsPastDate() {
        givenMember();

        assertThatThrownBy(() -> groupBetService.createBet(
                GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today().minusDays(1))))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("모레(오늘+2) → BET_CLOSED — 허용은 오늘·내일(KST)뿐이다(계약 §3)")
    void createBetRejectsDayAfterTomorrow() {
        givenMember();

        assertThatThrownBy(() -> groupBetService.createBet(
                GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today().plusDays(2))))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("내일(KST) 날짜 개설 허용 — 마감 후 '내일 시간대부터 적용' 경로(GROMO-1103)")
    void createBetAllowsTomorrowDate() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        LocalDate tomorrow = today().plusDays(1);
        givenNoConfigAndNoSession(tomorrow);

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, tomorrow));

        ArgumentCaptor<GroupChallengeBetSession> saved =
                ArgumentCaptor.forClass(GroupChallengeBetSession.class);
        verify(groupChallengeBetSessionRepository).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getSessionDate()).isEqualTo(tomorrow);
        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("오늘 창이 끝났어도 내일 개설은 허용 — 내일 회차는 창 마감 검사를 건너뛴다(계약 §3)")
    void createBetAllowsTomorrowEvenAfterTodayWindowClosed() {
        givenMember();
        givenChallenge(challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW));
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourAgo(), 0);
        LocalDate tomorrow = today().plusDays(1);
        givenNoConfigAndNoSession(tomorrow);

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, tomorrow));

        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
        // 창 마감 검사 자체가 불리지 않는다 — 내일 회차의 무조건 허용을 스텁 우회가 아니라 호출로 고정.
        verify(groupBetJudge, never()).windowClosesAt(any(), any());
    }

    @Test
    @DisplayName("SCREEN_TIME 챌린지에도 내기를 걸 수 있다 — 전 조합 허용")
    void createBetAllowsScreenTimeChallenge() {
        givenMember();
        GroupChallenge screenTime = challenge(MissionCategory.SCREEN_TIME, MissionType.DURATION);
        givenChallenge(screenTime);
        givenTarget(durationTarget(MissionCategory.SCREEN_TIME), null, GOAL_MINUTES - 10);
        givenNoConfigAndNoSession(today());

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today()));

        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("목표분 없는 구 창 챌린지 → INVALID_MISSION_PARAMS — 판정 불가라 돈을 걸 수 없다")
    void createBetRejectsChallengeWithoutGoal() {
        givenMember();
        givenChallenge(challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW));
        given(groupBetJudge.resolve(any())).willReturn(Optional.empty());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.INVALID_MISSION_PARAMS);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("오늘 창이 이미 끝난 뒤 개설 → BET_CLOSED — 결과가 정해진 판에 올라타기 차단")
    void createBetRejectsAfterWindowClosed() {
        givenMember();
        givenChallenge(challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW));
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourAgo(), 0);

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("스크린타임 개설 시점에 이미 목표 초과 → BET_ALREADY_FAILED — 질 게 정해진 판돈 투입 차단")
    void createBetRejectsWhenScreenTimeGoalAlreadyExceeded() {
        givenMember();
        givenChallenge(challenge(MissionCategory.SCREEN_TIME, MissionType.DURATION));
        givenTarget(durationTarget(MissionCategory.SCREEN_TIME), null, GOAL_MINUTES + 1);
        given(groupChallengeBetRepository.findByChallengeId(CHALLENGE_ID)).willReturn(Optional.empty());
        given(groupChallengeBetRepository.saveAndFlush(any())).willReturn(config());
        given(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(CONFIG_ID, today()))
                .willReturn(Optional.empty());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_FAILED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("INACTIVE 챌린지 → BET_CHALLENGE_INACTIVE — 레거시 ENDED(V2 이관) 챌린지에 판돈이 묶이면 안 된다")
    void createBetRejectsInactiveChallenge() {
        givenMember();
        givenChallenge(GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group())
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .status(GroupChallengeStatus.ENDED)
                .build());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CHALLENGE_INACTIVE);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("같은 날짜 회차가 이미 있으면(진행 중이든 정산됐든) → BET_ALREADY_EXISTS")
    void createBetRejectsDuplicateForSameChallengeAndDate() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        given(groupChallengeBetRepository.findByChallengeId(CHALLENGE_ID))
                .willReturn(Optional.of(config()));
        given(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(CONFIG_ID, today()))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_EXISTS);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("취소로 회차가 삭제된 날짜엔 재개설 허용 — 취소는 '없던 일'(행 삭제)이라 유니크에 걸리지 않는다")
    void createBetAllowsReopenAfterCanceledSession() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        // 설정은 남아 있고(설정은 지워지지 않는다) 그 날짜 회차만 없다 — 재개설이 열린다.
        given(groupChallengeBetRepository.findByChallengeId(CHALLENGE_ID))
                .willReturn(Optional.of(config()));
        given(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(CONFIG_ID, today()))
                .willReturn(Optional.empty());
        given(groupChallengeBetSessionRepository.saveAndFlush(any()))
                .willAnswer(invocation -> invocation.getArgument(0, GroupChallengeBetSession.class));

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today()));

        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("사전 검사를 통과했는데 회차 저장이 유니크 위반 → 레이스로 보고 BET_ALREADY_EXISTS 강하, 차감 없음")
    void createBetDowngradesUniqueViolationRaceToAlreadyExists() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        given(groupChallengeBetRepository.findByChallengeId(CHALLENGE_ID))
                .willReturn(Optional.of(config()));
        given(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(CONFIG_ID, today()))
                .willReturn(Optional.empty());
        // 검사와 삽입 사이에 다른 개설이 먼저 커밋된 판 — UNIQUE (bet_id, session_date)가 거절한다.
        given(groupChallengeBetSessionRepository.saveAndFlush(any())).willThrow(
                new DataIntegrityViolationException("uq_group_challenge_bet_sessions_bet_date"));

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_EXISTS);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("개설 시점에 이미 목표 달성 → BET_ALREADY_ACHIEVED (공짜 승리 차단)")
    void createBetRejectsWhenGoalAlreadyAchieved() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(GOAL_MINUTES);   // 목표와 동일 = 달성
        given(groupChallengeBetRepository.findByChallengeId(CHALLENGE_ID)).willReturn(Optional.empty());
        given(groupChallengeBetRepository.saveAndFlush(any())).willReturn(config());
        given(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(CONFIG_ID, today()))
                .willReturn(Optional.empty());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_ACHIEVED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("게스트도 신원 가드에 걸리지 않는다 — 멤버십 검사까지 진행 후 MEMBER_ONLY (GROMO-1509)")
    void createBetAllowsGuest() {
        // given: 게스트지만 멤버십이 없다 — 가드가 남아 있으면 GUEST_FORBIDDEN 으로 먼저 튕겨 실패한다
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(guest()));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group()));
        given(groupMemberRepository.findActiveByUserIdAndGroupIdForShare(USER_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("활성 멤버십이 없으면 개설 불가 → MEMBER_ONLY — 참여 경로는 멤버십 공유 락 조회다(N54)")
    void createBetRejectsNonMember() {
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(member()));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group()));
        given(groupMemberRepository.findActiveByUserIdAndGroupIdForShare(USER_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("탈퇴한 유저의 참가 시도 — 공유 락 활성 조회가 빈 결과 → USER_NOT_FOUND, 판돈 미차감 (GROMO-801·1247)")
    void joinBetRejectsWithdrawnUser() {
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.empty());

        // GROMO-1247: 내기·그룹 부재와 구분되는 요청자 전용 코드다.
        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(UserException.class)
                .hasFieldOrPropertyWithValue("errorCode", UserErrorCode.USER_NOT_FOUND);
        assertNoStakeCharged();
    }

    // ── 참가 ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("참가 성공 → 참가 행 생성 + 판돈 차감 (멱등키 session:{sid}:stake:{pid})")
    void joinBetChargesStake() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(30);

        groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).save(any());
        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30),
                eq("session:" + SESSION_ID + ":stake:" + PARTICIPANT_ID));
    }

    @Test
    @DisplayName("참가 시 그 날짜의 기존 창 사용분 보고를 무효화한다 — 참가 전 선기록 차단(GROMO-1407)")
    void joinBetInvalidatesPreJoinWindowUsageReport() {
        givenMember();
        GroupChallengeBetSession target = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(target));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(30);

        groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID);

        // 참가 경로가 무효화를 위임한다 — 조합별 적용 여부 판단은 위임처가 회차 스냅샷으로 한다.
        verify(groupBetWindowUsageService).invalidatePreJoinReport(target, USER_ID);
    }

    @Test
    @DisplayName("차감이 멱등키 선점으로 스킵되면(false) 참가 자체를 되돌린다 — 참가비 0원 참가 차단")
    void joinBetRollsBackWhenStakeDebitSkipped() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(30);
        given(currencyLedgerService.debit(any(), any(), anyInt(), anyString())).willReturn(false);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("없는 회차(또는 남의 그룹 회차) → BET_NOT_FOUND")
    void joinBetRejectsUnknownSession() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("이미 정산된 회차 → BET_CLOSED")
    void joinBetRejectsSettledSession() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.SETTLED, today())));

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("전일자 회차는 아직 OPEN 이어도 마감 → BET_CLOSED (배치가 돌기 전 구간)")
    void joinBetRejectsYesterdaySessionStillOpen() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today().minusDays(1))));

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("내일 회차 참가 허용 — 마감 후 열린 내일 회차에 오늘 밤 합류할 수 있다(GROMO-1103)")
    void joinBetAllowsTomorrowSession() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today().plusDays(1))));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(0);

        groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("중복 참가 → BET_ALREADY_JOINED, 이중 차감 없음")
    void joinBetRejectsDuplicateJoin() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(true);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_JOINED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("이미 목표를 달성한 뒤 참가 → BET_ALREADY_ACHIEVED (무위험 참가 차단)")
    void joinBetRejectsAlreadyAchieved() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(GOAL_MINUTES + 5);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_ACHIEVED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("창형 참가 — 오늘 창이 이미 끝났으면 BET_CLOSED (날짜는 오늘이라 날짜 가드로는 못 막는다)")
    void joinBetRejectsAfterWindowClosed() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourAgo(), 0);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("FOCUS 창형 참가 — 관용치(5분) 안쪽까지 도달했으면 이미 달성이라 BET_ALREADY_ACHIEVED")
    void joinBetRejectsWindowFocusAchievedWithinTolerance() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        // 목표 120분, 관용치 5분 → 115분이면 이미 달성 판정이다(카드·정산과 같은 기준).
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourLater(), GOAL_MINUTES - 5);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_ACHIEVED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("FOCUS 창형 참가 — 관용치 경계 바로 바깥(6분 모자람)은 아직 미달성이라 참가 허용")
    void joinBetAllowsWindowFocusJustOutsideTolerance() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourLater(), GOAL_MINUTES - 6);

        groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("스크린타임 참가 — 목표와 같은 사용분(경계 직전)은 잠정 달성이라 참가를 허용한다")
    void joinBetAllowsScreenTimeExactlyAtGoal() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenTarget(durationTarget(MissionCategory.SCREEN_TIME), null, GOAL_MINUTES);

        groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("스크린타임 참가 — 목표를 1분이라도 넘겼으면 패배 확정이라 BET_ALREADY_FAILED")
    void joinBetRejectsScreenTimeJustOverGoal() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenTarget(durationTarget(MissionCategory.SCREEN_TIME), null, GOAL_MINUTES + 1);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_FAILED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("스크린타임 창형 참가 — 아직 보고가 없으면(미보고) 참가를 막지 않는다")
    void joinBetAllowsScreenTimeWindowWithoutReport() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenTarget(windowTarget(MissionCategory.SCREEN_TIME), oneHourLater(), null);

        groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("잔액 부족 → INSUFFICIENT_CURRENCY 전파 (트랜잭션 롤백으로 참가 행도 남지 않는다)")
    void joinBetPropagatesInsufficientCurrency() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(0);
        willThrow(new CurrencyException(CurrencyErrorCode.INSUFFICIENT_CURRENCY))
                .given(currencyLedgerService).debit(any(), any(), anyInt(), anyString());

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(CurrencyException.class)
                .hasFieldOrPropertyWithValue("errorCode", CurrencyErrorCode.INSUFFICIENT_CURRENCY);
    }

    @Test
    @DisplayName("집중 기록이 아예 없으면 0분으로 보고 참가를 허용한다")
    void joinBetTreatsMissingStatAsZeroMinutes() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(null);

        groupBetService.joinBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    // ── 취소 (레거시 브리지 — 단독 참가 회차의 "없던 일" 처리) ─────────────────

    /** 참가 행 — id 를 채우는 이유는 환불 멱등키가 그 값을 축으로 삼기 때문이다(FR-42). */
    private GroupChallengeBetParticipant participantOf(
            GroupChallengeBetSession target, UUID participantUserId) {
        return participantOf(target, participantUserId, Instant.now());
    }

    /** 참가 시각 지정판 — 취소 마감 분기(N22)가 참가 시각 기준이라 경계 테스트가 값을 고른다. */
    private GroupChallengeBetParticipant participantOf(
            GroupChallengeBetSession target, UUID participantUserId, Instant joinedAt) {
        return GroupChallengeBetParticipant.builder()
                .id(USER_ID.equals(participantUserId) ? PARTICIPANT_ID : OTHER_PARTICIPANT_ID)
                .session(target)
                .user(User.builder().id(participantUserId).isGuest(false).build())
                .createdAt(joinedAt)
                .build();
    }

    /** 환불이 한 푼도 나가지 않았음을 단언한다 — 취소 거절 경로의 필수 조건. */
    private void assertNoRefundIssued() {
        verify(currencyLedgerService, never()).credit(any(), any(), anyInt(), anyString());
    }

    @Test
    @DisplayName("취소 성공 — 참가 삭제 + 환불(멱등키 session:{sid}:refund:{pid}) + 회차 행 삭제('없던 일')")
    void cancelBetRefundsStakeAndDeletesSession() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        GroupChallengeBetParticipant mine = participantOf(session, USER_ID);
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(mine));
        given(currencyLedgerService.credit(any(), any(), anyInt(), anyString())).willReturn(true);

        groupBetService.cancelBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("session:" + SESSION_ID + ":refund:" + PARTICIPANT_ID));
        // 빈 유저 개설 회차는 "없던 일" — 같은 날짜 재개설이 유니크에 막히지 않도록 행을 지운다.
        verify(groupChallengeBetSessionRepository).delete(session);
    }

    @Test
    @DisplayName("내일 회차 취소 — 미래 회차에서도 같은 경로가 동작한다(GROMO-1103)")
    void cancelBetRefundsTomorrowSession() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today().plusDays(1));
        GroupChallengeBetParticipant mine = participantOf(session, USER_ID);
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(mine));
        given(currencyLedgerService.credit(any(), any(), anyInt(), anyString())).willReturn(true);

        groupBetService.cancelBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("session:" + SESSION_ID + ":refund:" + PARTICIPANT_ID));
        verify(groupChallengeBetSessionRepository).delete(session);
    }

    @Test
    @DisplayName("참가자가 아니면 → BET_CANCEL_FORBIDDEN, 환불 없음 (구 '개설자 아님'의 재편 후 해석)")
    void cancelBetRejectsNonParticipant() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, OTHER_USER_ID)));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_FORBIDDEN);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("타인이 참가한 회차 → BET_CANCEL_HAS_OTHERS — '질 것 같으면 무르기' 차단")
    void cancelBetRejectsWhenOthersJoined() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, USER_ID), participantOf(session, OTHER_USER_ID)));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("이미 종료된 회차 → BET_NOT_OPEN, 환불 없음")
    void cancelBetRejectsClosedSession() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.SETTLED, today());
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, USER_ID)));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertNoRefundIssued();
        verify(groupChallengeBetSessionRepository, never()).delete(any(GroupChallengeBetSession.class));
    }

    @Test
    @DisplayName("없는 회차(또는 남의 그룹 회차) 취소 → BET_NOT_FOUND")
    void cancelBetRejectsUnknownSession() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("내가 이미 철회한 회차에 cancelBet — 타인 행만 남아 BET_CANCEL_FORBIDDEN")
    void cancelBetRejectsAfterAlreadyLeft() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today().plusDays(1));
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, OTHER_USER_ID)));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_FORBIDDEN);
        assertNoRefundIssued();
    }

    // ── 조회 조립 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("오늘의 회차 응답에 creatorUserId(최초 참가자)가 실린다 — 구앱 취소 버튼 판정용 브리지")
    void loadCurrentBetsCarriesCreatorUserId() {
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of());

        assertThat(bets.get(CHALLENGE_ID).getCreatorUserId()).isEqualTo(USER_ID);
    }

    @Test
    @DisplayName("오늘의 회차 응답에 date(session_date)가 실린다 — 내일 회차 표시·철회 판정용")
    void loadCurrentBetsCarriesSessionDate() {
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of());

        assertThat(bets.get(CHALLENGE_ID).getDate()).isEqualTo(today());
        // 오늘 회차가 있으면(우선) 내일 폴백 조회는 아예 나가지 않는다 — 계약 §3 응답 보수.
        verify(groupChallengeBetSessionRepository, never())
                .findByChallengeIdInAndSessionDateAndStatus(any(), any(), any());
    }

    @Test
    @DisplayName("오늘 회차가 없으면 내일 OPEN 회차를 폴백으로 싣는다 — date=내일, 오늘 달성값으로 잠그지 않는다")
    void loadCurrentBetsFallsBackToTomorrowOpenSession() {
        LocalDate tomorrow = today().plusDays(1);
        GroupChallengeBetSession tomorrowSession = session(GroupBetStatus.OPEN, tomorrow);
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.OPEN))
                .willReturn(List.of(tomorrowSession));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(tomorrowSession, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(CHALLENGE_ID, true));

        GroupBetResponse response = bets.get(CHALLENGE_ID);
        assertThat(response.getBetId()).isEqualTo(SESSION_ID);
        assertThat(response.getDate()).isEqualTo(tomorrow);
        // 오늘 달성 스냅샷(true)이 내일 회차의 myAchievedNow 로 새면 앱이 참가 버튼을 잘못 잠근다.
        assertThat(response.getMyAchievedNow()).isFalse();
    }

    @Test
    @DisplayName("과거 날짜 조회에는 내일 폴백이 없다 — 그날의 사실만 싣는다")
    void loadCurrentBetsDoesNotFallBackForPastDate() {
        LocalDate yesterday = today().minusDays(1);
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), yesterday, GroupBetStatus.UNUSED))
                .willReturn(List.of());

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), yesterday, USER_ID, Map.of());

        assertThat(bets).isEmpty();
        verify(groupChallengeBetSessionRepository, never())
                .findByChallengeIdInAndSessionDateAndStatus(any(), any(), any());
    }

    @Test
    @DisplayName("정산된 어제 회차는 계속 실린다 — 결과 모달의 hadBet(어제 bet 존재) 판정 회귀 방어")
    void loadCurrentBetsKeepsSettledYesterdaySessionForResultModal() {
        LocalDate yesterday = today().minusDays(1);
        GroupChallengeBetSession settled = session(GroupBetStatus.SETTLED, yesterday);
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), yesterday, GroupBetStatus.UNUSED))
                .willReturn(List.of(settled));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(settled, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), yesterday, USER_ID, Map.of());

        assertThat(bets.get(CHALLENGE_ID).getStatus()).isEqualTo(GroupBetStatus.SETTLED);
    }

    // ── 탈퇴자 명단 치환 (GROMO-1220, D1) ────────────────────────────────

    /** 탈퇴 유저의 참가 행 — 소프트딜리트로 nickname 은 파기(null)됐고 is_deleted=true 다. */
    private GroupChallengeBetParticipant withdrawnParticipantOf(GroupChallengeBetSession target) {
        return GroupChallengeBetParticipant.builder()
                .id(OTHER_PARTICIPANT_ID)
                .session(target)
                .user(User.builder().id(OTHER_USER_ID).isGuest(false).isDeleted(true).build())
                .createdAt(Instant.now().plusSeconds(60))
                .build();
    }

    @Test
    @DisplayName("정산 명단의 탈퇴자 닉네임은 '탈퇴한 사용자'로 치환된다 — 명단·인원·pot 은 불변 (GROMO-1220, D1)")
    void loadLastSettledBetsMasksWithdrawnUserNickname() {
        GroupChallengeBetSession settled = session(GroupBetStatus.SETTLED, today().minusDays(1));
        given(groupChallengeBetSessionRepository.findLatestSettledByChallengeIds(List.of(CHALLENGE_ID)))
                .willReturn(List.of(settled));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(settled, USER_ID), withdrawnParticipantOf(settled)));

        Map<UUID, GroupBetResultResponse> results =
                groupBetService.loadLastSettledBets(List.of(CHALLENGE_ID));

        GroupBetResultResponse response = results.get(CHALLENGE_ID);
        // 계약 §1 — 행 제거·pot 재계산 금지: pot = stake(30) × 원본 인원(2) 그대로다.
        assertThat(response.getPot()).isEqualTo(60);
        assertThat(response.getResults()).hasSize(2);
        assertThat(response.getResults())
                .extracting(GroupBetResultParticipantResponse::getUserId)
                .containsExactly(USER_ID, OTHER_USER_ID);
        assertThat(response.getResults().get(1).getNickname())
                .isEqualTo(GroupBetService.WITHDRAWN_USER_NICKNAME);
        assertThat(response.getResults().get(0).getNickname())
                .isNotEqualTo(GroupBetService.WITHDRAWN_USER_NICKNAME);
    }

    @Test
    @DisplayName("최근 정산 회차의 goalMinutes 는 개설 시점 박제값이다 (GROMO-1263)")
    void loadLastSettledBetsCarriesSnapshotGoalMinutes() {
        GroupChallengeBetSession settled = session(GroupBetStatus.SETTLED, today().minusDays(1));
        given(groupChallengeBetSessionRepository.findLatestSettledByChallengeIds(List.of(CHALLENGE_ID)))
                .willReturn(List.of(settled));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(settled, USER_ID)));

        Map<UUID, GroupBetResultResponse> results =
                groupBetService.loadLastSettledBets(List.of(CHALLENGE_ID));

        assertThat(results.get(CHALLENGE_ID).getGoalMinutes()).isEqualTo(GOAL_MINUTES);
    }

    @Test
    @DisplayName("진행 중 회차의 참가자 명단도 탈퇴자를 치환한다 — 해제 전 유령 참가 행 방어 (GROMO-1220)")
    void loadCurrentBetsMasksWithdrawnParticipantNickname() {
        GroupChallengeBetSession open = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(open));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(open, USER_ID), withdrawnParticipantOf(open)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of());

        GroupBetResponse response = bets.get(CHALLENGE_ID);
        assertThat(response.getPot()).isEqualTo(60);
        assertThat(response.getParticipants()).hasSize(2);
        assertThat(response.getParticipants().get(1).getNickname())
                .isEqualTo(GroupBetService.WITHDRAWN_USER_NICKNAME);
    }

    // ── 신앱 additive 필드 (GROMO-1418 — bet.session·enabled·다음 회차 축) ─────

    @Test
    @DisplayName("오늘 회차 응답에 session(카운트다운 축)·enabled 가 병기된다 — 레거시 4필드는 불변 (N36 보강)")
    void loadCurrentBetsCarriesSessionAdditiveFields() {
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        // 참가 시각을 박아 결정적으로 만든다(자정 직전 실행 플레이크 방지) — 00:10 KST 참가.
        GroupChallengeBetParticipant mine = GroupChallengeBetParticipant.builder()
                .id(PARTICIPANT_ID)
                .session(session)
                .user(User.builder().id(USER_ID).isGuest(false).build())
                .createdAt(session.getStartsAt().plusSeconds(600))
                .build();
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(mine));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(), Map.of());

        GroupBetResponse response = bets.get(CHALLENGE_ID);
        // 레거시 필드는 그대로다 — 구앱 계약(N36).
        assertThat(response.getBetId()).isEqualTo(SESSION_ID);
        assertThat(response.getMyJoined()).isTrue();
        assertThat(response.getEnabled()).isTrue();
        GroupBetSessionResponse sessionResponse = response.getSession();
        assertThat(sessionResponse).isNotNull();
        assertThat(sessionResponse.getSessionId()).isEqualTo(SESSION_ID);
        assertThat(sessionResponse.getSessionDate()).isEqualTo(today());
        assertThat(sessionResponse.getJoinClosesAt()).isEqualTo(session.getJoinClosesAt());
        assertThat(sessionResponse.getStartsAt()).isEqualTo(session.getStartsAt());
        assertThat(sessionResponse.getMyJoined()).isTrue();
        // 시작 후 참가(하루형 — 오늘 회차는 자정에 시작됐다) → 취소 마감 = 참가 + 5분(N22).
        assertThat(sessionResponse.getMyLeaveDeadlineAt())
                .isEqualTo(mine.getCreatedAt().plus(GroupBetService.LEAVE_GRACE));
    }

    @Test
    @DisplayName("미참여 회차의 myLeaveDeadlineAt 은 null — 취소 진입점이 없다")
    void loadCurrentBetsSessionLeaveDeadlineIsNullWhenNotJoined() {
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, OTHER_USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(), Map.of());

        GroupBetSessionResponse sessionResponse = bets.get(CHALLENGE_ID).getSession();
        assertThat(sessionResponse.getMyJoined()).isFalse();
        assertThat(sessionResponse.getMyLeaveDeadlineAt()).isNull();
    }

    @Test
    @DisplayName("내일 폴백 회차의 session 은 null — 오늘 축이 하루 밀리면 카운트다운이 거짓말한다")
    void loadCurrentBetsTomorrowFallbackDoesNotFillSession() {
        LocalDate tomorrow = today().plusDays(1);
        GroupChallengeBetSession tomorrowSession = session(GroupBetStatus.OPEN, tomorrow);
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.OPEN))
                .willReturn(List.of(tomorrowSession));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(tomorrowSession, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(), Map.of());

        GroupBetResponse response = bets.get(CHALLENGE_ID);
        // 레거시 필드는 폴백을 계속 싣는다(계약 §3 응답 보수) — 신 필드만 오늘로 고정된다.
        assertThat(response.getBetId()).isEqualTo(SESSION_ID);
        assertThat(response.getDate()).isEqualTo(tomorrow);
        assertThat(response.getSession()).isNull();
    }

    @Test
    @DisplayName("하루형 회차 참가자에 진행분·판정이 실린다 (N16 — 참가 시트 진행분 공개)")
    void loadCurrentBetsSessionCarriesDurationParticipantProgress() {
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(session, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(),
                Map.of(CHALLENGE_ID, List.of(ChallengeMemberProgressResponse.builder()
                        .userId(USER_ID).nickname("재영").progressMinutes(90).achieved(false).build())));

        GroupBetSessionResponse sessionResponse = bets.get(CHALLENGE_ID).getSession();
        assertThat(sessionResponse.getParticipants()).hasSize(1);
        assertThat(sessionResponse.getParticipants().get(0).getProgressMinutes()).isEqualTo(90);
        assertThat(sessionResponse.getParticipants().get(0).getAchieved()).isFalse();
    }

    @Test
    @DisplayName("다음 회차 축(하루형) — nextSessionAt=다음 활성일 00:00 KST, 내 참가 행이 있으면 joined=true")
    void loadNextSessionsCarriesTomorrowAxisForDuration() {
        LocalDate tomorrow = today().plusDays(1);
        GroupChallengeBetSession tomorrowSession = session(GroupBetStatus.OPEN, tomorrow);
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.OPEN))
                .willReturn(List.of(tomorrowSession));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(tomorrowSession, USER_ID)));

        Map<UUID, GroupBetService.NextSessionInfo> result = groupBetService.loadNextSessions(
                List.of(focusChallenge()), Map.of(), USER_ID);

        GroupBetService.NextSessionInfo info = result.get(CHALLENGE_ID);
        assertThat(info.nextSessionAt()).isEqualTo(tomorrow.atStartOfDay(KST).toInstant());
        assertThat(info.nextSessionJoined()).isTrue();
    }

    @Test
    @DisplayName("다음 회차 축(창형) — nextSessionAt=다음 활성일의 창 시작, 회차가 아직 없으면 joined=false")
    void loadNextSessionsUsesWindowStartAndDefaultsJoinedFalse() {
        LocalDate tomorrow = today().plusDays(1);
        GroupChallenge windowChallenge = challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW);
        GroupChallengeWindow window = GroupChallengeWindow.builder()
                .challengeId(CHALLENGE_ID)
                .challenge(windowChallenge)
                .windowStart(LocalTime.of(9, 0))
                .windowEnd(LocalTime.of(12, 0))
                .build();
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.OPEN))
                .willReturn(List.of());

        Map<UUID, GroupBetService.NextSessionInfo> result = groupBetService.loadNextSessions(
                List.of(windowChallenge), Map.of(CHALLENGE_ID, window), USER_ID);

        GroupBetService.NextSessionInfo info = result.get(CHALLENGE_ID);
        assertThat(info.nextSessionAt())
                .isEqualTo(tomorrow.atTime(LocalTime.of(9, 0)).atZone(KST).toInstant());
        assertThat(info.nextSessionJoined()).isFalse();
    }

    @Test
    @DisplayName("다음 회차가 있으면 그 회차의 박제 stake 를 싣는다 — 설정값과 갈려도 차감 금액이 정본")
    void loadNextSessionsCarriesSnapshotStakeOfNextSession() {
        LocalDate tomorrow = today().plusDays(1);
        // 설정은 30 인데 내일 회차는 100 으로 박제된 상태(구앱이 날짜별로 다른 금액을 개설했다).
        GroupChallengeBetSession tomorrowSession = GroupChallengeBetSession.builder()
                .id(SESSION_ID)
                .bet(config())
                .group(group())
                .challenge(focusChallenge())
                .sessionDate(tomorrow)
                .stake(100)
                .goalMinutes(GOAL_MINUTES)
                .missionCategory(MissionCategory.FOCUS)
                .missionType(MissionType.DURATION)
                .status(GroupBetStatus.OPEN)
                .startsAt(tomorrow.atStartOfDay(KST).toInstant())
                .joinClosesAt(tomorrow.plusDays(1).atStartOfDay(KST).toInstant())
                .closesAt(tomorrow.plusDays(1).atStartOfDay(KST).toInstant())
                .settleAfter(tomorrow.plusDays(1).atStartOfDay(KST).toInstant())
                .build();
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.OPEN))
                .willReturn(List.of(tomorrowSession));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of());

        Map<UUID, GroupBetService.NextSessionInfo> result = groupBetService.loadNextSessions(
                List.of(focusChallenge()), Map.of(), USER_ID);

        assertThat(result.get(CHALLENGE_ID).stake()).isEqualTo(100);
    }

    @Test
    @DisplayName("다음 회차가 아직 없으면 stake 는 null — 앱은 betConfig.stake 로 안내한다")
    void loadNextSessionsLeavesStakeNullWithoutSession() {
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                List.of(CHALLENGE_ID), today().plusDays(1), GroupBetStatus.OPEN))
                .willReturn(List.of());

        Map<UUID, GroupBetService.NextSessionInfo> result = groupBetService.loadNextSessions(
                List.of(focusChallenge()), Map.of(), USER_ID);

        assertThat(result.get(CHALLENGE_ID).stake()).isNull();
    }

    @Test
    @DisplayName("창형인데 창 상세가 없으면 다음 회차 축이 없다 — 설 수 없는 회차를 예고하지 않는다")
    void loadNextSessionsSkipsWindowChallengeWithoutDetail() {
        GroupChallenge windowChallenge = challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW);

        Map<UUID, GroupBetService.NextSessionInfo> result =
                groupBetService.loadNextSessions(List.of(windowChallenge), Map.of(), USER_ID);

        assertThat(result).isEmpty();
        verify(groupChallengeBetSessionRepository, never())
                .findByChallengeIdInAndSessionDateAndStatus(any(), any(), any());
    }

    @Test
    @DisplayName("ENDED 챌린지는 다음 회차 축에서 빠진다 — 끝난 챌린지에 다음 회차는 없다")
    void loadNextSessionsSkipsEndedChallenges() {
        GroupChallenge ended = GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group())
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .status(GroupChallengeStatus.ENDED)
                .build();

        Map<UUID, GroupBetService.NextSessionInfo> result =
                groupBetService.loadNextSessions(List.of(ended), Map.of(), USER_ID);

        assertThat(result).isEmpty();
        verify(groupChallengeBetSessionRepository, never())
                .findByChallengeIdInAndSessionDateAndStatus(any(), any(), any());
    }

    // ── 내기 설정 축 betConfig (codex ① — bet 과 분리해 구앱 계약을 건드리지 않는다) ──────

    @Test
    @DisplayName("회차가 없어도 betConfig 는 실린다 — 신앱 진입점 유지 (bet 은 종전대로 null)")
    void loadBetConfigsCarriesEnabledConfigRegardlessOfSession() {
        given(groupChallengeBetRepository.findEnabledByChallengeIdIn(List.of(CHALLENGE_ID)))
                .willReturn(List.of(config()));

        Map<UUID, GroupBetConfigResponse> configs =
                groupBetService.loadBetConfigs(List.of(CHALLENGE_ID));

        assertThat(configs.get(CHALLENGE_ID).getEnabled()).isTrue();
        assertThat(configs.get(CHALLENGE_ID).getStake()).isEqualTo(30);
    }

    @Test
    @DisplayName("설정이 없는(꺼짐·끝난·삭제 포함) 챌린지는 betConfig 가 없다 — 진입점 없음")
    void loadBetConfigsOmitsChallengesWithoutEnabledConfig() {
        given(groupChallengeBetRepository.findEnabledByChallengeIdIn(List.of(CHALLENGE_ID)))
                .willReturn(List.of());

        assertThat(groupBetService.loadBetConfigs(List.of(CHALLENGE_ID))).isEmpty();
    }

    @Test
    @DisplayName("회차가 없는 날의 bet 은 null 이다 — 구앱이 「내기 걸기」(createBet 브리지)를 그대로 탄다")
    void loadCurrentBetsStaysNullWithoutSession() {
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                List.of(CHALLENGE_ID), today().plusDays(1), GroupBetStatus.OPEN))
                .willReturn(List.of());

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(), Map.of());

        assertThat(bets).isEmpty();
        // 설정 조회는 betConfig 축의 몫이다 — bet 조립은 회차만 본다(축 분리).
        verify(groupChallengeBetRepository, never()).findEnabledByChallengeIdIn(any());
    }

    // ── 라이브 명단 필터 (codex ② — 시작 전 회차의 비활성 멤버, LLD §2.1 · C8) ─────

    /** 그룹의 활성 멤버 = 나 혼자 — 상대(OTHER_USER_ID)는 강퇴되어 멤버십 행이 is_left 다. */
    private void givenOnlyMeIsActiveMember() {
        given(groupMemberRepository.findByGroupIdIn(Set.of(GROUP_ID)))
                .willReturn(List.of(GroupMember.builder()
                        .user(member()).group(group()).role(GroupMemberRole.MEMBER).build()));
    }

    @Test
    @DisplayName("시작 전 회차 — 강퇴 멤버는 라이브 명단에서 빠진다(팟은 실제 참가비라 불변)")
    void loadCurrentBetsFiltersKickedMemberFromPreStartSession() {
        // 내일 회차 = 아직 시작 전. 오늘 조회에 폴백으로 실리지 않도록 date 를 내일로 준다.
        LocalDate tomorrow = today().plusDays(1);
        GroupChallengeBetSession upcoming = session(GroupBetStatus.OPEN, tomorrow);
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.UNUSED))
                .willReturn(List.of(upcoming));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(upcoming, USER_ID),
                        participantOf(upcoming, OTHER_USER_ID)));
        givenOnlyMeIsActiveMember();

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), tomorrow, USER_ID, Map.of(), Map.of());

        GroupBetSessionResponse sessionResponse = bets.get(CHALLENGE_ID).getSession();
        assertThat(sessionResponse.getParticipants())
                .extracting(p -> p.getUserId())
                .containsExactly(USER_ID);
        // 팟은 강퇴자 참가비까지 포함한 실제 금액이다(계약 §1 — 명단만 가린다).
        assertThat(sessionResponse.getPot()).isEqualTo(60);
        // 레거시 명단은 브리지 계약대로 손대지 않는다(구앱 동작 불변).
        assertThat(bets.get(CHALLENGE_ID).getParticipants()).hasSize(2);
    }

    @Test
    @DisplayName("시작된 회차의 강퇴 참가자도 진행률이 계산된다 — 명단에 세울 거면 판정도 세운다")
    void loadCurrentBetsFillsProgressForKickedParticipantOnStartedSession() {
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(started));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(started, USER_ID),
                        participantOf(started, OTHER_USER_ID)));
        // 강퇴자(OTHER_USER_ID)는 카드 memberProgress 모수(활성 그룹원)에 없다.
        GroupBetJudge.Target target = durationTarget(MissionCategory.FOCUS);
        given(groupBetJudge.ofSession(any())).willReturn(Optional.of(target));
        // 오버로드(단건/배치)가 둘 다 있어 매처로 대상을 못 박는다 — 보강 집계는 단건판이다.
        given(groupBetJudge.progressMinutes(any(GroupBetJudge.Target.class), eq(today()), any()))
                .willReturn(Map.of(OTHER_USER_ID, GOAL_MINUTES + 10));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(),
                Map.of(CHALLENGE_ID, List.of(ChallengeMemberProgressResponse.builder()
                        .userId(USER_ID).nickname("재영").progressMinutes(30).achieved(false).build())));

        GroupBetSessionResponse sessionResponse = bets.get(CHALLENGE_ID).getSession();
        GroupBetSessionParticipantResponse kicked = sessionResponse.getParticipants().stream()
                .filter(p -> p.getUserId().equals(OTHER_USER_ID))
                .findFirst()
                .orElseThrow();
        assertThat(kicked.getProgressMinutes()).isEqualTo(GOAL_MINUTES + 10);
        assertThat(kicked.getAchieved()).isTrue();
        // 활성 그룹원은 카드 스냅샷을 그대로 쓴다(중복 집계 없음).
        assertThat(sessionResponse.getParticipants().get(0).getProgressMinutes()).isEqualTo(30);
    }

    @Test
    @DisplayName("시작 전 회차에는 보강 집계가 없다 — 비활성 멤버는 애초에 명단에서 빠진다")
    void loadCurrentBetsSkipsProgressBackfillOnPreStartSession() {
        LocalDate tomorrow = today().plusDays(1);
        GroupChallengeBetSession upcoming = session(GroupBetStatus.OPEN, tomorrow);
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.UNUSED))
                .willReturn(List.of(upcoming));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(upcoming, USER_ID)));
        givenOnlyMeIsActiveMember();

        groupBetService.loadCurrentBets(List.of(CHALLENGE_ID), tomorrow, USER_ID, Map.of(), Map.of());

        verify(groupBetJudge, never())
                .progressMinutes(any(GroupBetJudge.Target.class), any(), any());
    }

    @Test
    @DisplayName("시작된 회차 — 강퇴 멤버도 명단에 남는다(정산 대상이라 지우면 결과와 갈린다, C8)")
    void loadCurrentBetsKeepsKickedMemberOnStartedSession() {
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(started));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(started, USER_ID),
                        participantOf(started, OTHER_USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(), Map.of());

        assertThat(bets.get(CHALLENGE_ID).getSession().getParticipants()).hasSize(2);
        // 시작된 회차뿐이면 멤버십 조회 자체가 필요 없다(필터가 없다).
        verify(groupMemberRepository, never()).findByGroupIdIn(any());
    }

    // ── 탈퇴 박제값 폴백 (codex — 카드 명단이 정산과 같은 근거를 본다, GROMO-1423) ──

    /**
     * 계정 탈퇴 직전에 판정 근거가 박제된 참가 행 — {@code freezeEvidenceForAccountErasure} 가
     * {@code achieved=true} + 그 시점 실측 분을 남긴 뒤 통계가 nullify 된 상태다(GROMO-1423).
     */
    private GroupChallengeBetParticipant erasedParticipantOf(
            GroupChallengeBetSession target, int frozenMinutes) {
        return GroupChallengeBetParticipant.builder()
                .id(OTHER_PARTICIPANT_ID)
                .session(target)
                .user(User.builder().id(OTHER_USER_ID).isGuest(false).isDeleted(true).build())
                .achieved(true)
                .achievedAt(Instant.now())
                .progressMinutes(frozenMinutes)
                .createdAt(Instant.now())
                .build();
    }

    /** 카드 memberProgress 스냅샷 — 활성 그룹원(나)만 들어 있다(탈퇴·강퇴자는 모수 밖). */
    private Map<UUID, List<ChallengeMemberProgressResponse>> myProgressOnly(int minutes) {
        return Map.of(CHALLENGE_ID, List.of(ChallengeMemberProgressResponse.builder()
                .userId(USER_ID).nickname("재영").progressMinutes(minutes).achieved(false).build()));
    }

    private GroupBetSessionParticipantResponse sessionRowOf(
            Map<UUID, GroupBetResponse> bets, UUID targetUserId) {
        return bets.get(CHALLENGE_ID).getSession().getParticipants().stream()
                .filter(p -> p.getUserId().equals(targetUserId))
                .findFirst()
                .orElseThrow();
    }

    /** 시작된 오늘 회차 + (나, 상대) 2인 참가 — 보강 집계가 도는 최소 조건. */
    private Map<UUID, GroupBetResponse> loadStartedSessionWith(
            GroupChallengeBetSession started, GroupChallengeBetParticipant other,
            GroupBetJudge.Target target, Map<UUID, Integer> measured) {
        given(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(CHALLENGE_ID), today(), GroupBetStatus.UNUSED))
                .willReturn(List.of(started));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participantOf(started, USER_ID), other));
        given(groupBetJudge.ofSession(any())).willReturn(Optional.of(target));
        // 오버로드(단건/배치)가 둘 다 있어 매처로 대상을 못 박는다 — 보강 집계는 단건판이다.
        given(groupBetJudge.progressMinutes(any(GroupBetJudge.Target.class), eq(today()), any()))
                .willReturn(measured);
        return groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(), myProgressOnly(30));
    }

    @Test
    @DisplayName("탈퇴로 통계가 사라진 FOCUS 달성자 — 카드 명단이 박제값을 쓴다(0분/미달성으로 접히지 않는다)")
    void loadCurrentBetsFallsBackToFrozenEvidenceForErasedFocusAchiever() {
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, today());
        // nullify 이후라 실측이 하나도 없다 — 종전 판은 FOCUS 규칙대로 0분/미달성으로 접었고,
        // 정산은 박제값으로 달성 처리해 명단과 결과가 갈렸다.
        Map<UUID, GroupBetResponse> bets = loadStartedSessionWith(
                started, erasedParticipantOf(started, GOAL_MINUTES + 40),
                durationTarget(MissionCategory.FOCUS), Map.of());

        GroupBetSessionParticipantResponse erased = sessionRowOf(bets, OTHER_USER_ID);
        assertThat(erased.getProgressMinutes()).isEqualTo(GOAL_MINUTES + 40);
        assertThat(erased.getAchieved()).isTrue();
    }

    @Test
    @DisplayName("탈퇴로 통계가 사라진 SCREEN_TIME 달성자 — 미판정(—)이 아니라 박제값으로 보인다")
    void loadCurrentBetsFallsBackToFrozenEvidenceForErasedScreenTimeAchiever() {
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, today());
        // 탈퇴는 권한 설정 행까지 지우므로 SCREEN_TIME 실측은 항상 미보고(null)로 떨어진다.
        Map<UUID, GroupBetResponse> bets = loadStartedSessionWith(
                started, erasedParticipantOf(started, GOAL_MINUTES - 40),
                durationTarget(MissionCategory.SCREEN_TIME), Map.of());

        GroupBetSessionParticipantResponse erased = sessionRowOf(bets, OTHER_USER_ID);
        assertThat(erased.getProgressMinutes()).isEqualTo(GOAL_MINUTES - 40);
        assertThat(erased.getAchieved()).isTrue();
    }

    @Test
    @DisplayName("실측이 있으면 박제값이 이기지 못한다 — 조기 확정된 강퇴자의 최신 실측이 실린다")
    void loadCurrentBetsPrefersMeasuredMinutesOverFrozenEvidence() {
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, today());
        // 조기 확정(GROMO-1268)으로 achieved=true + 확정 시점 분이 박혀 있지만 통계는 살아 있다.
        GroupChallengeBetParticipant earlyConfirmed = GroupChallengeBetParticipant.builder()
                .id(OTHER_PARTICIPANT_ID)
                .session(started)
                .user(User.builder().id(OTHER_USER_ID).isGuest(false).build())
                .achieved(true)
                .achievedAt(Instant.now())
                .progressMinutes(GOAL_MINUTES)
                .createdAt(Instant.now())
                .build();

        Map<UUID, GroupBetResponse> bets = loadStartedSessionWith(
                started, earlyConfirmed, durationTarget(MissionCategory.FOCUS),
                Map.of(OTHER_USER_ID, GOAL_MINUTES + 50));

        GroupBetSessionParticipantResponse row = sessionRowOf(bets, OTHER_USER_ID);
        assertThat(row.getProgressMinutes()).isEqualTo(GOAL_MINUTES + 50);
        assertThat(row.getAchieved()).isTrue();
    }

    @Test
    @DisplayName("박제가 없으면 종전 그대로 — 강퇴자의 FOCUS 무기록은 0분/미달성이다(값을 지어내지 않는다)")
    void loadCurrentBetsKeepsZeroForKickedParticipantWithoutFrozenEvidence() {
        GroupChallengeBetSession started = session(GroupBetStatus.OPEN, today());
        Map<UUID, GroupBetResponse> bets = loadStartedSessionWith(
                started, participantOf(started, OTHER_USER_ID),
                durationTarget(MissionCategory.FOCUS), Map.of());

        GroupBetSessionParticipantResponse row = sessionRowOf(bets, OTHER_USER_ID);
        assertThat(row.getProgressMinutes()).isZero();
        assertThat(row.getAchieved()).isFalse();
    }

    // ── 취소 마감 단일 판정점 (N22 — 카드 myLeaveDeadlineAt 과 철회 판정 공용) ──

    @Test
    @DisplayName("시작 전 참가(예약분)의 취소 마감 = 회차 시작 — 유예 없음(N22)")
    void leaveDeadlineIsStartsAtForPreStartJoin() {
        GroupChallengeBetSession tomorrowSession = session(GroupBetStatus.OPEN, today().plusDays(1));
        GroupChallengeBetParticipant mine = participantOf(tomorrowSession, USER_ID);

        assertThat(GroupBetService.leaveDeadline(tomorrowSession, mine))
                .isEqualTo(tomorrowSession.getStartsAt());
    }

    @Test
    @DisplayName("시작 후 참가(하루형)의 취소 마감 = min(참가+5분, 회차 종료) (N22)")
    void leaveDeadlineIsGraceCappedAtClose() {
        GroupChallengeBetSession todaySession = session(GroupBetStatus.OPEN, today());
        // 시작 1시간 뒤 참가 — 유예(+5분)가 종료 상한에 걸리지 않는 구간.
        GroupChallengeBetParticipant mine = GroupChallengeBetParticipant.builder()
                .id(PARTICIPANT_ID)
                .session(todaySession)
                .user(User.builder().id(USER_ID).isGuest(false).build())
                .createdAt(todaySession.getStartsAt().plusSeconds(3600))
                .build();
        assertThat(GroupBetService.leaveDeadline(todaySession, mine))
                .isEqualTo(mine.getCreatedAt().plus(GroupBetService.LEAVE_GRACE));

        // 종료 직전 참가 — 유예가 자정(정산 CAS)을 넘지 못하게 종료 시각으로 상한된다.
        GroupChallengeBetParticipant lateJoin = GroupChallengeBetParticipant.builder()
                .id(PARTICIPANT_ID)
                .session(todaySession)
                .user(User.builder().id(USER_ID).isGuest(false).build())
                .createdAt(todaySession.getClosesAt().minusSeconds(60))
                .build();
        assertThat(GroupBetService.leaveDeadline(todaySession, lateJoin))
                .isEqualTo(todaySession.getClosesAt());
    }

    // ── 활성 요일 검증 (N35 — 레거시 개설 브리지, PR #567 이관) ────────────────

    @Test
    @DisplayName("비활성 요일 날짜 개설 → BET_CLOSED — 참가비 미차감 (실제 repeat_days 기준)")
    void createBetRejectsInactiveWeekday() {
        givenMember();
        // 오늘을 쉬는 날로 둔 실제 챌린지 — 시임을 덮지 않는다. 판정은 카드의 activeToday 와
        // 같은 함수(RepeatSchedule.activeOn × challenge.getRepeatDays())를 탄다.
        LocalDate today = GroupBetService.today();
        givenChallenge(challengeRepeating(
                RepeatSchedule.EVERYDAY ^ RepeatSchedule.bit(today.getDayOfWeek())));

        assertThatThrownBy(() -> groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID,
                request(30, today)))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        // 돈 경로 — 쉬는 날 개설은 참가비를 한 푼도 건드리지 않는다.
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("월요일 전용 챌린지 — 개설 가능한 두 날짜(오늘·내일) 중 월요일이 아닌 날은 거부 + 참가비 미차감")
    void createBetHonoursMondayOnlySchedule() {
        givenMember();
        givenChallenge(challengeRepeating(RepeatSchedule.bit(DayOfWeek.MONDAY)));
        LocalDate today = GroupBetService.today();

        // 개설 창(계약 §3)은 오늘·내일뿐이라 "화요일"을 고정할 수 없다 — 대신 그 창에서 월요일이
        // 아닌 날을 전부 훑는다. 오늘이 일·월이면 하나, 그 밖엔 둘이 걸린다.
        List<LocalDate> inactiveDates = Stream.of(today, today.plusDays(1))
                .filter(d -> d.getDayOfWeek() != DayOfWeek.MONDAY)
                .toList();
        assertThat(inactiveDates).isNotEmpty();

        for (LocalDate inactive : inactiveDates) {
            assertThatThrownBy(() -> groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID,
                    request(30, inactive)))
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        }
        // 돈 경로 — 쉬는 요일 개설 시도는 원장을 건드리지 않는다(종전에는 시임이 매일 활성이라
        // 회차가 서고 참가비가 걷혔다).
        assertNoStakeCharged();
        verify(groupChallengeBetSessionRepository, never()).saveAndFlush(any());
    }

    @Test
    @DisplayName("다음 회차 예고는 '내일'이 아니라 실제 다음 활성일이다 — 월요일 전용이면 다음 월요일")
    void nextSessionFollowsRepeatDaysNotTomorrow() {
        LocalDate today = GroupBetService.today();
        int mondayOnly = RepeatSchedule.bit(DayOfWeek.MONDAY);
        GroupChallenge mondayChallenge = challengeRepeating(mondayOnly);
        LocalDate expected = today.with(TemporalAdjusters.next(DayOfWeek.MONDAY));

        Map<UUID, GroupBetService.NextSessionInfo> next = groupBetService.loadNextSessions(
                List.of(mondayChallenge), Map.of(), USER_ID);

        // 하루형이라 다음 활성일 00:00 KST — 요일 배선 전에는 무조건 내일 자정이었다.
        assertThat(next.get(CHALLENGE_ID).nextSessionAt())
                .isEqualTo(expected.atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant());
        assertThat(expected).isEqualTo(RepeatSchedule.next(mondayOnly, today));
    }

    // ── 참가 철회 (GROMO-1102 — 재편 후 시작 전 판정은 회차 박제 startsAt) ────

    private void givenLeaveEntry(GroupChallengeBetSession target, GroupChallengeBetParticipant... participants) {
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.of(target));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of(participants));
    }

    @Test
    @DisplayName("철회 성공(내일 하루형) — 본인 참가 행만 삭제 + 환불, 남은 참가자가 있어 회차는 유지")
    void leaveBetRefundsLeaverAndKeepsSessionOpen() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today().plusDays(1));
        GroupChallengeBetParticipant mine = participantOf(session, USER_ID);
        givenLeaveEntry(session, mine, participantOf(session, OTHER_USER_ID));
        given(currencyLedgerService.credit(any(), any(), anyInt(), anyString())).willReturn(true);

        groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        // 환불 키는 경로 불문 단일 축(session:{sid}:refund:{pid}, FR-42) — 취소·탈퇴와 같은 키라
        // 어떤 경로 조합으로도 참가 행당 환불이 1회를 넘을 수 없다(원장 유니크 최후 방어).
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("session:" + SESSION_ID + ":refund:" + PARTICIPANT_ID));
        // 남은 참가자가 있으므로 회차는 지우지 않는다.
        verify(groupChallengeBetSessionRepository, never()).delete(any(GroupChallengeBetSession.class));
        // 철회는 챌린지를 건드리지 않는다.
        verify(groupChallengeRepository, never())
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(any(), any());
    }

    @Test
    @DisplayName("마지막 참가자 철회 — 본인 환불 + 회차 행 삭제('없던 일')")
    void leaveBetDeletesSessionWhenLastParticipantLeaves() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today().plusDays(1));
        GroupChallengeBetParticipant mine = participantOf(session, USER_ID);
        givenLeaveEntry(session, mine);
        given(currencyLedgerService.credit(any(), any(), anyInt(), anyString())).willReturn(true);

        groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        verify(groupChallengeBetSessionRepository).delete(session);
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("session:" + SESSION_ID + ":refund:" + PARTICIPANT_ID));
        // 챌린지는 여러 날짜에 걸쳐 재사용되는 미션 템플릿이다 — 회차가 비었다고 지우지 않는다.
        verify(groupChallengeRepository, never())
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(any(), any());
    }

    @Test
    @DisplayName("미참가자 철회 → BET_NOT_JOINED — 환불도 행 삭제도 없다")
    void leaveBetRejectsNonParticipant() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today().plusDays(1));
        givenLeaveEntry(session, participantOf(session, OTHER_USER_ID));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_JOINED);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never())
                .delete(any(GroupChallengeBetParticipant.class));
    }

    @Test
    @DisplayName("검증 순서 — 미참가 + 이미 종료면 BET_NOT_JOINED 가 먼저다(참가자 → OPEN → 시작 전)")
    void leaveBetChecksParticipationBeforeStatus() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.SETTLED, today().minusDays(1));
        givenLeaveEntry(session, participantOf(session, OTHER_USER_ID));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_JOINED);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("정산이 끝난 회차(SETTLED/FORFEITED) 철회 → BET_NOT_OPEN, 환불 없음")
    void leaveBetRejectsSettledSession() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.SETTLED, today().minusDays(1));
        givenLeaveEntry(session, participantOf(session, USER_ID));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never())
                .delete(any(GroupChallengeBetParticipant.class));
    }

    /** 참가 시각을 지정한 내 참가 행 — 취소 마감(N22)이 참가 시점 기준이라 경계 테스트에 필요하다. */
    private GroupChallengeBetParticipant myParticipantJoinedAt(
            GroupChallengeBetSession target, Instant joinedAt) {
        return GroupChallengeBetParticipant.builder()
                .id(PARTICIPANT_ID)
                .session(target)
                .user(member())
                .createdAt(joinedAt)
                .build();
    }

    @Test
    @DisplayName("하루형 당일 참가 — 참가+5분 유예 안이면 철회 성공 (N22 오탭 구제, 응답 myLeaveDeadlineAt 과 같은 판정)")
    void leaveBetAllowsSameDayDurationWithinGrace() {
        givenMember();
        // 시작(자정)은 이미 지났고 참가는 1분 전 — 유예(5분) 안이다.
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        GroupChallengeBetParticipant mine =
                myParticipantJoinedAt(session, Instant.now().minus(1, ChronoUnit.MINUTES));
        givenLeaveEntry(session, mine, participantOf(session, OTHER_USER_ID));
        given(currencyLedgerService.credit(any(), any(), anyInt(), anyString())).willReturn(true);

        groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("session:" + SESSION_ID + ":refund:" + PARTICIPANT_ID));
    }

    @Test
    @DisplayName("하루형 당일 참가 — 유예 5분이 지나면 BET_LEAVE_CLOSED (경계 바깥)")
    void leaveBetRejectsSameDayDurationAfterGrace() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        givenLeaveEntry(session,
                myParticipantJoinedAt(session, Instant.now().minus(6, ChronoUnit.MINUTES)));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never())
                .delete(any(GroupChallengeBetParticipant.class));
    }

    @Test
    @DisplayName("시작 전 참가(예약분)는 유예가 붙지 않는다 — 시작이 지나면 참가 직후여도 BET_LEAVE_CLOSED (N22)")
    void leaveBetGivesNoGraceToPreStartJoin() {
        givenMember();
        // 창이 1분 전에 시작됐고, 나는 그 2분 전(시작 전)에 참가했다 → 마감은 창 시작 = 이미 지남.
        Instant startedAt = Instant.now().minus(1, ChronoUnit.MINUTES);
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today(), startedAt);
        givenLeaveEntry(session,
                myParticipantJoinedAt(session, startedAt.minus(2, ChronoUnit.MINUTES)));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("응답의 myLeaveDeadlineAt 과 철회 판정이 같은 함수를 쓴다 — 화면이 거짓말하지 않는다")
    void leaveDeadlineIsSharedByResponseAndLeaveGuard() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        // 마감(참가+5분)이 방금 지난 참가 행 — 응답이 주는 값과 서비스 판정이 같은 경계여야 한다.
        Instant joinedAt = Instant.now().minus(GroupBetService.LEAVE_GRACE).minusSeconds(1);
        GroupChallengeBetParticipant mine = myParticipantJoinedAt(session, joinedAt);
        givenLeaveEntry(session, mine);

        assertThat(GroupBetService.leaveDeadline(session, mine))
                .isEqualTo(joinedAt.plus(GroupBetService.LEAVE_GRACE))
                .isBefore(Instant.now());
        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
    }

    @Test
    @DisplayName("창형 — 오늘 회차여도 창 시작 전이면 철회할 수 있다 (박제 startsAt 기준)")
    void leaveBetAllowsWindowSessionBeforeWindowStarts() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today(), oneHourLater());
        GroupChallengeBetParticipant mine = participantOf(session, USER_ID);
        givenLeaveEntry(session, mine, participantOf(session, OTHER_USER_ID));
        given(currencyLedgerService.credit(any(), any(), anyInt(), anyString())).willReturn(true);

        groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("session:" + SESSION_ID + ":refund:" + PARTICIPANT_ID));
    }

    @Test
    @DisplayName("창형 — 창이 이미 시작됐으면 BET_LEAVE_CLOSED (시작 전 참가엔 5분 유예가 없다 — N22)")
    void leaveBetRejectsWindowSessionAfterWindowStarts() {
        givenMember();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today(), oneHourAgo());
        // 창 시작 전에 참가 → 마감은 창 시작(N22, 유예 없음)이라 이미 지났다.
        // 유예를 주면 창 초반을 보고 발을 빼는 각도가 생긴다.
        givenLeaveEntry(session,
                myParticipantJoinedAt(session, session.getStartsAt().minusSeconds(600)));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never())
                .delete(any(GroupChallengeBetParticipant.class));
    }

    @Test
    @DisplayName("없는 회차(또는 남의 그룹 회차) 철회 → BET_NOT_FOUND")
    void leaveBetRejectsUnknownSession() {
        givenMember();
        given(groupChallengeBetSessionRepository.findByIdAndGroupIdForUpdate(SESSION_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertNoRefundIssued();
    }

    // ── 계정 탈퇴 일괄 해제 (GROMO-801) ──────────────────────────────────

    @Test
    @DisplayName("계정 탈퇴 일괄 해제 — 전 회차 잠금을 전부 확보한 뒤에만 환불이 시작된다 (잠금 후 재조회 포함)")
    void releaseFromAllOpenBetsLocksEverySessionBeforeMovingMoney() {
        // 그룹 단위 순차 해제(잠금→환불→잠금→환불)는 앞 그룹 환불로 지갑 행 잠금을 쥔 채 다음
        // 그룹의 회차 잠금을 기다리게 되어, 반대 순서로 잠그는 정산기와 AB-BA 교착이 된다.
        User leaver = User.builder().id(USER_ID).isGuest(false).build();
        UUID otherSessionId = UUID.fromString("00000000-0000-0000-0000-0000000000b2");
        GroupChallengeBetSession firstSession = session(GroupBetStatus.OPEN, today());
        GroupChallengeBetSession secondSession = GroupChallengeBetSession.builder()
                .id(otherSessionId)
                .bet(config())
                .group(group())
                .challenge(focusChallenge())
                .sessionDate(today())
                .stake(30)
                .goalMinutes(GOAL_MINUTES)
                .missionCategory(MissionCategory.FOCUS)
                .missionType(MissionType.DURATION)
                .status(GroupBetStatus.OPEN)
                .startsAt(today().atStartOfDay(KST).toInstant())
                .joinClosesAt(today().plusDays(1).atStartOfDay(KST).toInstant())
                .closesAt(today().plusDays(1).atStartOfDay(KST).toInstant())
                .settleAfter(today().plusDays(1).atStartOfDay(KST).toInstant())
                .build();
        given(groupChallengeBetSessionRepository.findOpenSessionIdsByParticipantUserId(USER_ID))
                .willReturn(List.of(SESSION_ID, otherSessionId));
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(firstSession));
        given(groupChallengeBetSessionRepository.findByIdForUpdate(otherSessionId))
                .willReturn(Optional.of(secondSession));
        // 잠금 후 재조회(P0 ③) — 내 참가 행이 아직 남아 있는 판. 다른 참가자도 2명 남아
        // 회차 삭제 없이 환불만 나간다.
        given(groupChallengeBetParticipantRepository.findBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(Optional.of(participantOf(firstSession, USER_ID)));
        given(groupChallengeBetParticipantRepository.findBySessionIdAndUserId(otherSessionId, USER_ID))
                .willReturn(Optional.of(GroupChallengeBetParticipant.builder()
                        .id(OTHER_PARTICIPANT_ID).session(secondSession).user(leaver)
                        // 취소 마감 분기(N22) 통과용 — 방금 참가라 유예 안이고, 두 회차 모두 환불된다.
                        .createdAt(Instant.now()).build()));
        given(groupChallengeBetParticipantRepository.countBySessionId(any())).willReturn(2L);
        given(currencyLedgerService.credit(
                eq(leaver), eq(CurrencyTransactionType.BET_REFUND), eq(30), anyString()))
                .willReturn(true);

        groupBetService.releaseFromAllOpenBets(leaver);

        // 잠금 2건이 모두 끝난 뒤에야 환불 2건이 나간다 — 잠금 사이에 환불이 끼면 여기서 깨진다.
        InOrder lockThenMoney = inOrder(groupChallengeBetSessionRepository, currencyLedgerService);
        lockThenMoney.verify(groupChallengeBetSessionRepository).findByIdForUpdate(SESSION_ID);
        lockThenMoney.verify(groupChallengeBetSessionRepository).findByIdForUpdate(otherSessionId);
        lockThenMoney.verify(currencyLedgerService, times(2))
                .credit(eq(leaver), eq(CurrencyTransactionType.BET_REFUND), eq(30), anyString());
        // 잔여 참가자가 있어 회차는 지우지 않는다.
        verify(groupChallengeBetSessionRepository, never()).delete(any(GroupChallengeBetSession.class));
    }

    @Test
    @DisplayName("탈퇴 연동 — 잠금 후 재조회에서 참가 행이 이미 없으면 환불하지 않는다 (이중 환불 TOCTOU 차단)")
    void releaseSkipsRefundWhenParticipantAlreadyGone() {
        // 대상 id 조회와 잠금 사이에 본인 철회(leaveBet)가 먼저 커밋된 인터리빙 — 구조상
        // 참가 행 재조회가 빈 결과라 환불이 나가지 않는다(1258 P0 ① 재발 방지의 단위 증명).
        User leaver = User.builder().id(USER_ID).isGuest(false).build();
        GroupChallengeBetSession session = session(GroupBetStatus.OPEN, today());
        given(groupChallengeBetSessionRepository.findOpenSessionIdsByParticipantUserId(USER_ID))
                .willReturn(List.of(SESSION_ID));
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(Optional.empty());

        groupBetService.releaseFromAllOpenBets(leaver);

        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never())
                .delete(any(GroupChallengeBetParticipant.class));
    }

    @Test
    @DisplayName("그룹 탈퇴 연동 — 멤버십 행 배타 잠금을 먼저 잡는다 (참여 경로의 공유 잠금과 직렬화, N54)")
    void releaseFromOpenBetsLocksMembershipRowFirst() {
        User leaver = User.builder().id(USER_ID).isGuest(false).build();
        given(groupMemberRepository.findActiveByUserIdAndGroupIdForUpdate(USER_ID, GROUP_ID))
                .willReturn(Optional.empty());
        given(groupChallengeBetSessionRepository.findOpenSessionIdsByGroupIdAndParticipantUserId(
                GROUP_ID, USER_ID)).willReturn(List.of());

        groupBetService.releaseFromOpenBets(leaver, group());

        InOrder membershipThenScan =
                inOrder(groupMemberRepository, groupChallengeBetSessionRepository);
        membershipThenScan.verify(groupMemberRepository)
                .findActiveByUserIdAndGroupIdForUpdate(USER_ID, GROUP_ID);
        membershipThenScan.verify(groupChallengeBetSessionRepository)
                .findOpenSessionIdsByGroupIdAndParticipantUserId(GROUP_ID, USER_ID);
    }
}

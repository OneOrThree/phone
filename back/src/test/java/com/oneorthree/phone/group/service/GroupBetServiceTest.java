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
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 내기 개설·참가 가드 단위 테스트.
 *
 * <p>돈이 걸리는 경로라 "거절되어야 할 때 확실히 거절되는가"가 핵심이다 — 목표 없는 챌린지,
 * 허용 판돈, 오늘 날짜, 창 마감, 중복 개설/참가, 카테고리별 참가 가드(FOCUS 이미 달성 /
 * SCREEN_TIME 이미 초과), 잔액 부족. 거절 시 <b>판돈이 차감되지 않는지</b>까지 함께 본다.
 *
 * <p>분배 규칙은 {@link GroupBetPayoutCalculatorTest}, 정산 멱등은
 * {@code GroupBetSettlementIntegrationTest} 가 맡는다.
 *
 * <p>{@code CreateBetRequest} 는 builder/all-args 생성자가 없어 mock() 으로 대체한다
 * ({@link GroupChallengeServiceTest} 의 CreateChallengeRequest 관행과 동일).
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
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;

    @Mock
    private CurrencyLedgerService currencyLedgerService;

    /**
     * 조합별 판정 소스는 {@link GroupBetJudge} 가 쥔다 — 여기서는 그 결과를 받아 <b>어떤 가드로
     * 갈라지는지</b>만 본다(소스 자체의 정확성은 {@code GroupBetCategorySettlementIntegrationTest}).
     * 단, {@code isAchieved} 는 정적 순수 함수라 스텁 없이 실제 규칙(관용치 포함)이 그대로 돈다.
     */
    @Mock
    private GroupBetJudge groupBetJudge;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID BET_ID = UUID.fromString("00000000-0000-0000-0000-0000000000b1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    /** 참가 행 id — 차감·철회 환불 멱등키의 축이라(계약 §2-2) 단위 테스트에서도 실제 값이 필요하다. */
    private static final UUID PARTICIPANT_ID = UUID.fromString("00000000-0000-0000-0000-0000000000e1");
    private static final UUID OTHER_PARTICIPANT_ID =
            UUID.fromString("00000000-0000-0000-0000-0000000000e2");

    private static final int GOAL_MINUTES = 120;

    /**
     * 참가 경로 공통 스텁 — {@code stakeIn} 은 저장된 참가 행의 id 로 차감 멱등키를 만들고
     * ({@code bet:{betId}:stake:{participantId}}), 차감이 스킵되면(false) 무임승차를 막으려고
     * 트랜잭션을 되돌린다. 거절 경로에는 도달하지 않는 스텁이라 lenient 로 둔다.
     */
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

    /**
     * 요청 DTO 는 값 운반체일 뿐 상호작용을 단언하는 협력자가 아니다. 이른 거절 경로에서는 stake 만
     * 읽고 끝나기도 하므로 lenient 로 둔다(그러지 않으면 UnnecessaryStubbing 으로 실패한다).
     */
    private CreateBetRequest request(int stake, LocalDate date) {
        CreateBetRequest request = mock(CreateBetRequest.class);
        lenient().when(request.getStake()).thenReturn(stake);
        lenient().when(request.getDate()).thenReturn(date);
        return request;
    }

    /** 유저·그룹원 검증까지 통과하는 공통 스텁. */
    private User givenMember() {
        User user = member();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group()));
        given(groupMemberRepository.findByUserAndGroup(any(), any()))
                .willReturn(Optional.of(GroupMember.builder()
                        .user(user).group(group()).role(GroupMemberRole.MEMBER).build()));
        return user;
    }

    private void givenChallenge(GroupChallenge challenge) {
        // 개설은 챌린지 행을 잠그고 읽는다(삭제와 직렬화) — 스텁도 락 조회 쪽에 건다.
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForUpdate(eq(CHALLENGE_ID), any()))
                .willReturn(Optional.of(challenge));
    }

    /** 일 목표(DURATION) 대상. 카테고리만 갈아끼워 4조합의 절반을 만든다. */
    private GroupBetJudge.Target durationTarget(MissionCategory category) {
        return new GroupBetJudge.Target(challenge(category, MissionType.DURATION), GOAL_MINUTES, null);
    }

    /** 창 목표(TIME_WINDOW) 대상 — 창 시각은 판정에 안 쓰이고(마감은 아래 스텁) 목표분만 의미가 있다. */
    private GroupBetJudge.Target windowTarget(MissionCategory category) {
        GroupChallenge windowChallenge = challenge(category, MissionType.TIME_WINDOW);
        return new GroupBetJudge.Target(windowChallenge, GOAL_MINUTES, GroupChallengeWindow.builder()
                .challengeId(CHALLENGE_ID)
                .challenge(windowChallenge)
                .windowStartAt(Instant.parse("1970-01-01T09:00:00+09:00"))
                .windowEndAt(Instant.parse("1970-01-01T12:00:00+09:00"))
                .durationMinutes(GOAL_MINUTES)
                .build());
    }

    /**
     * 판정 소스 스텁 — 대상 해석 + 창 마감 시각 + 내 진행분.
     *
     * @param closesAt 창 마감(창형만). null 이면 DURATION 처럼 마감 검사가 없다
     * @param minutes  내 진행분. null 이면 데이터 없음(FOCUS=0분, SCREEN_TIME=미보고)
     */
    private void givenTarget(GroupBetJudge.Target target, Instant closesAt, Integer minutes) {
        given(groupBetJudge.resolve(any())).willReturn(Optional.of(target));
        lenient().when(groupBetJudge.windowClosesAt(eq(target), any()))
                .thenReturn(Optional.ofNullable(closesAt));
        lenient().when(groupBetJudge.progressMinutes(eq(target), any(), any()))
                .thenReturn(minutes == null ? Map.of() : Map.of(USER_ID, minutes));
    }

    /** 기존 내기의 기본 조합(FOCUS × DURATION) + 내 집중 분. */
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

    private GroupChallengeBet bet(GroupBetStatus status, LocalDate betDate) {
        return GroupChallengeBet.builder()
                .id(BET_ID)
                .group(group())
                .challenge(focusChallenge())
                .creatorUser(member())
                .stake(30)
                .betDate(betDate)
                .status(status)
                .build();
    }

    /** 판돈이 한 푼도 움직이지 않았음을 단언한다 — 거절 경로의 필수 조건. */
    private void assertNoStakeCharged() {
        verify(currencyLedgerService, never()).debit(any(), any(), anyInt(), anyString());
        verify(groupChallengeBetParticipantRepository, never()).save(any());
    }

    // ── 개설 ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("개설 성공 → 내기 저장 + 개설자 자동 참가 + 참가비 차감(멱등키 bet:{betId}:stake:{participantId})")
    void createBetChargesStakeAndAutoJoinsCreator() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(false);
        given(groupChallengeBetRepository.save(any())).willReturn(bet(GroupBetStatus.OPEN, today()));

        CreateBetResponse response =
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today()));

        assertThat(response.getBetId()).isEqualTo(BET_ID);

        ArgumentCaptor<GroupChallengeBetParticipant> participant =
                ArgumentCaptor.forClass(GroupChallengeBetParticipant.class);
        verify(groupChallengeBetParticipantRepository).save(participant.capture());
        assertThat(participant.getValue().getUser().getId()).isEqualTo(USER_ID);
        assertThat(participant.getValue().getBet().getId()).isEqualTo(BET_ID);
        // 정산 전이므로 판정 결과는 비어 있어야 한다(null = 아직 판정 안 됨).
        assertThat(participant.getValue().getAchieved()).isNull();
        assertThat(participant.getValue().getPayout()).isNull();

        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), key.capture());
        // 축은 유저가 아니라 참가 행이다 — 철회 후 재참여가 같은 키를 만들어 차감이 조용히 스킵되면
        // 참가비 0원 참가가 성립한다(계약 §2, GROMO-1112).
        assertThat(key.getValue()).isEqualTo("bet:" + BET_ID + ":stake:" + PARTICIPANT_ID);
    }

    @Test
    @DisplayName("참가비 범위(1~1000) 밖 — 0·1001·음수 → BET_INVALID_STAKE, 차감 없음")
    void createBetRejectsStakeOutOfRange() {
        givenMember();

        for (int stake : new int[] {0, 1001, -10}) {
            assertThatThrownBy(() ->
                    groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(stake, today())))
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_INVALID_STAKE);
        }
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("참가비 경계값 1·1000 은 허용 — 자유 입력 확대(계약 §2), 프리셋 밖 값도 그대로 저장된다")
    void createBetAllowsStakeBoundaries() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(false);
        given(groupChallengeBetRepository.save(any())).willReturn(bet(GroupBetStatus.OPEN, today()));

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(1, today()));
        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(1000, today()));

        ArgumentCaptor<GroupChallengeBet> saved = ArgumentCaptor.forClass(GroupChallengeBet.class);
        verify(groupChallengeBetRepository, times(2)).save(saved.capture());
        assertThat(saved.getAllValues())
                .extracting(GroupChallengeBet::getStake)
                .containsExactly(1, 1000);
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
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, tomorrow))
                .willReturn(false);
        given(groupChallengeBetRepository.save(any())).willReturn(bet(GroupBetStatus.OPEN, tomorrow));

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, tomorrow));

        ArgumentCaptor<GroupChallengeBet> saved = ArgumentCaptor.forClass(GroupChallengeBet.class);
        verify(groupChallengeBetRepository).save(saved.capture());
        assertThat(saved.getValue().getBetDate()).isEqualTo(tomorrow);
        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("오늘 창이 끝났어도 내일 개설은 허용 — 내일 내기는 창 마감 검사를 건너뛴다(계약 §3)")
    void createBetAllowsTomorrowEvenAfterTodayWindowClosed() {
        givenMember();
        givenChallenge(challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW));
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourAgo(), 0);
        LocalDate tomorrow = today().plusDays(1);
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, tomorrow))
                .willReturn(false);
        given(groupChallengeBetRepository.save(any())).willReturn(bet(GroupBetStatus.OPEN, tomorrow));

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, tomorrow));

        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
        // 창 마감 검사 자체가 불리지 않는다 — 내일 내기의 무조건 허용을 스텁 우회가 아니라 호출로 고정.
        verify(groupBetJudge, never()).windowClosesAt(any(), any());
    }

    @Test
    @DisplayName("SCREEN_TIME 챌린지에도 내기를 걸 수 있다 — BET_FOCUS_ONLY 게이트 제거(전 조합 허용)")
    void createBetAllowsScreenTimeChallenge() {
        givenMember();
        GroupChallenge screenTime = challenge(MissionCategory.SCREEN_TIME, MissionType.DURATION);
        givenChallenge(screenTime);
        givenTarget(durationTarget(MissionCategory.SCREEN_TIME), null, GOAL_MINUTES - 10);
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(false);
        given(groupChallengeBetRepository.save(any())).willReturn(bet(GroupBetStatus.OPEN, today()));

        groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today()));

        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("창 목표분이 있는 TIME_WINDOW 챌린지에도 걸 수 있다 — 창이 아직 안 끝났으면 개설 성공")
    void createBetAllowsTimeWindowChallengeBeforeWindowCloses() {
        givenMember();
        givenChallenge(challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW));
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourLater(), 0);
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(false);
        given(groupChallengeBetRepository.save(any())).willReturn(bet(GroupBetStatus.OPEN, today()));

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
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(false);

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
        // 삭제된 것도 아니고(deleted_at null) 타입도 FOCUS/DURATION 이라 다른 가드는 전부 통과한다.
        givenChallenge(GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group())
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .status(GroupChallengeStatus.INACTIVE)
                .build());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CHALLENGE_INACTIVE);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("같은 챌린지·같은 날짜에 이미 내기가 있으면 → BET_ALREADY_EXISTS")
    void createBetRejectsDuplicateForSameChallengeAndDate() {
        givenMember();
        givenChallenge(focusChallenge());
        givenFocusDuration(10);
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(true);

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
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(false);

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_ACHIEVED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("게스트는 개설 불가 → GUEST_FORBIDDEN")
    void createBetRejectsGuest() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest()));

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.GUEST_FORBIDDEN);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("그룹원이 아니면 개설 불가 → MEMBER_ONLY")
    void createBetRejectsNonMember() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(member()));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group()));
        given(groupMemberRepository.findByUserAndGroup(any(), any())).willReturn(Optional.empty());

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        assertNoStakeCharged();
    }

    // ── 참가 ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("참가 성공 → 참가 행 생성 + 판돈 차감")
    void joinBetChargesStake() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(30);

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).save(any());
        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30),
                eq("bet:" + BET_ID + ":stake:" + PARTICIPANT_ID));
    }

    @Test
    @DisplayName("차감이 멱등키 선점으로 스킵되면(false) 참가 자체를 되돌린다 — 참가비 0원 참가 차단")
    void joinBetRollsBackWhenStakeDebitSkipped() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(30);
        // 참가 행 id 가 키에 들어간 뒤로 도달 불가한 상태다 — 그런데도 오면 키 규약이 깨진 것이라
        // 조용히 넘기지 않고 예외로 트랜잭션 전체를 되돌린다(차감 없는 참가 행 = 무임승차).
        given(currencyLedgerService.debit(any(), any(), anyInt(), anyString())).willReturn(false);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("없는 내기(또는 남의 그룹 내기) → BET_NOT_FOUND")
    void joinBetRejectsUnknownBet() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("이미 정산된 내기 → BET_CLOSED")
    void joinBetRejectsSettledBet() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.SETTLED, today())));

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("전일자 내기는 아직 OPEN 이어도 마감 → BET_CLOSED (배치가 돌기 전 04:00 이전 구간)")
    void joinBetRejectsYesterdayBetStillOpen() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today().minusDays(1))));

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("내일 내기 참가 허용 — 마감 후 열린 내일 내기에 오늘 밤 합류할 수 있다(GROMO-1103)")
    void joinBetAllowsTomorrowBet() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today().plusDays(1))));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(0);

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService)
                .debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("중복 참가 → BET_ALREADY_JOINED, 이중 차감 없음")
    void joinBetRejectsDuplicateJoin() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(true);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_JOINED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("이미 목표를 달성한 뒤 참가 → BET_ALREADY_ACHIEVED (무위험 참가 차단)")
    void joinBetRejectsAlreadyAchieved() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(GOAL_MINUTES + 5);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_ACHIEVED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("창형 참가 — 오늘 창이 이미 끝났으면 BET_CLOSED (날짜는 오늘이라 날짜 가드로는 못 막는다)")
    void joinBetRejectsAfterWindowClosed() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourAgo(), 0);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("FOCUS 창형 참가 — 관용치(5분) 안쪽까지 도달했으면 이미 달성이라 BET_ALREADY_ACHIEVED")
    void joinBetRejectsWindowFocusAchievedWithinTolerance() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        // 목표 120분, 관용치 5분 → 115분이면 이미 달성 판정이다(카드·정산과 같은 기준).
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourLater(), GOAL_MINUTES - 5);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_ACHIEVED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("FOCUS 창형 참가 — 관용치 경계 바로 바깥(6분 모자람)은 아직 미달성이라 참가 허용")
    void joinBetAllowsWindowFocusJustOutsideTolerance() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenTarget(windowTarget(MissionCategory.FOCUS), oneHourLater(), GOAL_MINUTES - 6);

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("스크린타임 참가 — 목표와 같은 사용분(경계 직전)은 잠정 달성이라 참가를 허용한다")
    void joinBetAllowsScreenTimeExactlyAtGoal() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenTarget(durationTarget(MissionCategory.SCREEN_TIME), null, GOAL_MINUTES);

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("스크린타임 참가 — 목표를 1분이라도 넘겼으면 패배 확정이라 BET_ALREADY_FAILED")
    void joinBetRejectsScreenTimeJustOverGoal() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenTarget(durationTarget(MissionCategory.SCREEN_TIME), null, GOAL_MINUTES + 1);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_FAILED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("스크린타임 창형 참가 — 아직 보고가 없으면(미보고) 참가를 막지 않는다")
    void joinBetAllowsScreenTimeWindowWithoutReport() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenTarget(windowTarget(MissionCategory.SCREEN_TIME), oneHourLater(), null);

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    @Test
    @DisplayName("잔액 부족 → INSUFFICIENT_CURRENCY 전파 (트랜잭션 롤백으로 참가 행도 남지 않는다)")
    void joinBetPropagatesInsufficientCurrency() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(0);
        willThrow(new CurrencyException(CurrencyErrorCode.INSUFFICIENT_CURRENCY))
                .given(currencyLedgerService).debit(any(), any(), anyInt(), anyString());

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(CurrencyException.class)
                .hasFieldOrPropertyWithValue("errorCode", CurrencyErrorCode.INSUFFICIENT_CURRENCY);
    }

    // ── 취소 ────────────────────────────────────────────────────────────

    /** 참가 행 — id 를 채우는 이유는 철회 환불 멱등키가 그 값을 축으로 삼기 때문이다(계약 §2-2). */
    private GroupChallengeBetParticipant participantOf(GroupChallengeBet target, UUID participantUserId) {
        return GroupChallengeBetParticipant.builder()
                .id(USER_ID.equals(participantUserId) ? PARTICIPANT_ID : OTHER_PARTICIPANT_ID)
                .bet(target)
                .user(User.builder().id(participantUserId).isGuest(false).build())
                .build();
    }

    /** 환불이 한 푼도 나가지 않았음을 단언한다 — 취소 거절 경로의 필수 조건. */
    private void assertNoRefundIssued() {
        verify(currencyLedgerService, never()).credit(any(), any(), anyInt(), anyString());
    }

    @Test
    @DisplayName("취소 성공 — CAS 로 CANCELED 전이 + 판돈 환불(멱등키 bet:{betId}:refund:{userId})")
    void cancelBetRefundsStake() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, USER_ID)));
        given(groupChallengeBetRepository.compareAndSetSettled(
                eq(BET_ID), eq(GroupBetStatus.CANCELED), any())).willReturn(1);

        groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("bet:" + BET_ID + ":refund:" + USER_ID));
    }

    @Test
    @DisplayName("내일 내기 취소 — OPEN CAS·환불 경로가 미래 내기에서도 그대로 동작한다(GROMO-1103)")
    void cancelBetRefundsTomorrowBet() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today().plusDays(1));
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, USER_ID)));
        given(groupChallengeBetRepository.compareAndSetSettled(
                eq(BET_ID), eq(GroupBetStatus.CANCELED), any())).willReturn(1);

        groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("bet:" + BET_ID + ":refund:" + USER_ID));
    }

    @Test
    @DisplayName("개설자가 아니면 → BET_CANCEL_FORBIDDEN, 환불 없음")
    void cancelBetRejectsNonCreator() {
        givenMember();
        GroupChallengeBet bet = GroupChallengeBet.builder()
                .id(BET_ID)
                .group(group())
                .challenge(focusChallenge())
                .creatorUser(User.builder().id(OTHER_USER_ID).isGuest(false).build())
                .stake(30)
                .betDate(today())
                .status(GroupBetStatus.OPEN)
                .build();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_FORBIDDEN);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("타인이 참가한 내기 → BET_CANCEL_HAS_OTHERS — '질 것 같으면 무르기' 차단")
    void cancelBetRejectsWhenOthersJoined() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, USER_ID), participantOf(bet, OTHER_USER_ID)));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("이미 종료된 내기(이중 취소 포함) → BET_NOT_OPEN, 환불 없음")
    void cancelBetRejectsClosedBet() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.CANCELED, today());
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, USER_ID)));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("검증과 전이 사이에 정산이 먼저 끝나면(CAS 0행) → BET_NOT_OPEN, 환불 없음")
    void cancelBetRejectsWhenSettlementWinsRace() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, USER_ID)));
        given(groupChallengeBetRepository.compareAndSetSettled(
                eq(BET_ID), eq(GroupBetStatus.CANCELED), any())).willReturn(0);

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("없는 내기(또는 남의 그룹 내기) 취소 → BET_NOT_FOUND")
    void cancelBetRejectsUnknownBet() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertNoRefundIssued();
    }

    // ── 조회 조립 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("오늘의 내기 응답에 creatorUserId 가 실린다 — 앱 취소 버튼 판정용(additive)")
    void loadCurrentBetsCarriesCreatorUserId() {
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        given(groupChallengeBetRepository.findByChallengeIdInAndBetDate(List.of(CHALLENGE_ID), today()))
                .willReturn(List.of(bet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of());

        assertThat(bets.get(CHALLENGE_ID).getCreatorUserId()).isEqualTo(USER_ID);
    }

    @Test
    @DisplayName("오늘의 내기 응답에 date(bet_date)가 실린다 — 내일 내기 표시·철회 판정용(additive)")
    void loadCurrentBetsCarriesBetDate() {
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        given(groupChallengeBetRepository.findByChallengeIdInAndBetDate(List.of(CHALLENGE_ID), today()))
                .willReturn(List.of(bet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of());

        assertThat(bets.get(CHALLENGE_ID).getDate()).isEqualTo(today());
        // 오늘 내기가 있으면(우선) 내일 폴백 조회는 아예 나가지 않는다 — 계약 §3 응답 보수.
        verify(groupChallengeBetRepository, never())
                .findByChallengeIdInAndBetDateAndStatus(any(), any(), any());
    }

    @Test
    @DisplayName("오늘 내기가 없으면 내일 OPEN 내기를 폴백으로 싣는다 — date=내일, 오늘 달성값으로 잠그지 않는다")
    void loadCurrentBetsFallsBackToTomorrowOpenBet() {
        LocalDate tomorrow = today().plusDays(1);
        GroupChallengeBet tomorrowBet = bet(GroupBetStatus.OPEN, tomorrow);
        given(groupChallengeBetRepository.findByChallengeIdInAndBetDate(List.of(CHALLENGE_ID), today()))
                .willReturn(List.of());
        given(groupChallengeBetRepository.findByChallengeIdInAndBetDateAndStatus(
                List.of(CHALLENGE_ID), tomorrow, GroupBetStatus.OPEN))
                .willReturn(List.of(tomorrowBet));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(tomorrowBet, USER_ID)));

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), today(), USER_ID, Map.of(CHALLENGE_ID, true));

        GroupBetResponse response = bets.get(CHALLENGE_ID);
        assertThat(response.getBetId()).isEqualTo(BET_ID);
        assertThat(response.getDate()).isEqualTo(tomorrow);
        // 오늘 달성 스냅샷(true)이 내일 내기의 myAchievedNow 로 새면 앱이 참가 버튼을 잘못 잠근다 —
        // 내일 내기의 판정일은 내일이라 아직 아무도 달성하지 않았다.
        assertThat(response.getMyAchievedNow()).isFalse();
    }

    @Test
    @DisplayName("과거 날짜 조회에는 내일 폴백이 없다 — 그날의 사실만 싣는다")
    void loadCurrentBetsDoesNotFallBackForPastDate() {
        LocalDate yesterday = today().minusDays(1);
        given(groupChallengeBetRepository.findByChallengeIdInAndBetDate(List.of(CHALLENGE_ID), yesterday))
                .willReturn(List.of());

        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                List.of(CHALLENGE_ID), yesterday, USER_ID, Map.of());

        assertThat(bets).isEmpty();
        verify(groupChallengeBetRepository, never())
                .findByChallengeIdInAndBetDateAndStatus(any(), any(), any());
    }

    @Test
    @DisplayName("집중 기록이 아예 없으면 0분으로 보고 참가를 허용한다")
    void joinBetTreatsMissingStatAsZeroMinutes() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenFocusDuration(null);

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }

    // ── 참가 철회 (GROMO-1102) ──────────────────────────────────────────

    /**
     * 철회 진입 스텁 — 잠금 조회가 {@code bet} 을, 참가자 배치 로드가 {@code participants} 를 돌려준다.
     * 시작 전 판정({@code windowOpensAt})은 철회 전용이라 여기서 스텁하지 않는다(가드에 걸려 도달하지
     * 않는 경로가 있어 테스트마다 명시한다).
     */
    private void givenLeaveEntry(GroupChallengeBet target, GroupChallengeBetParticipant... participants) {
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(target));
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participants));
    }

    /** 시작 전 판정 스텁 — {@code opensAt} null 이면 DURATION(창 없음)처럼 날짜 경계만 본다. */
    private void givenOpensAt(GroupBetJudge.Target target, Instant opensAt) {
        given(groupBetJudge.resolve(any())).willReturn(Optional.of(target));
        given(groupBetJudge.windowOpensAt(eq(target), any())).willReturn(Optional.ofNullable(opensAt));
    }

    @Test
    @DisplayName("철회 성공(내일 DURATION) — 본인 참가 행만 삭제 + 환불, 남은 참가자가 있어 내기는 유지")
    void leaveBetRefundsLeaverAndKeepsBetOpen() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today().plusDays(1));
        GroupChallengeBetParticipant mine = participantOf(bet, USER_ID);
        givenLeaveEntry(bet, mine, participantOf(bet, OTHER_USER_ID));
        givenOpensAt(durationTarget(MissionCategory.FOCUS), null);

        groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        // 철회 환불은 차감과 같은 축(참가 행)의 전용 키다 — 정산 환불 키와 겹치지 않는다(계약 §2-2).
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("bet:" + BET_ID + ":leave-refund:" + PARTICIPANT_ID));
        // 남은 참가자가 있으므로 내기는 닫지 않는다 — 개설자 철회여도 마찬가지다(creatorUserId 는 이력).
        verify(groupChallengeBetRepository, never()).compareAndSetSettled(any(), any(), any());
        // 철회는 챌린지를 건드리지 않는다 — 판이 하루 비었다고 그룹 공용 미션을 지우지 않는다.
        verify(groupChallengeRepository, never())
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(any(), any());
    }

    @Test
    @DisplayName("마지막 참가자 철회 — CAS 로 CANCELED 전이 + 본인 환불(원자적 자동 취소)")
    void leaveBetCancelsWhenLastParticipantLeaves() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today().plusDays(1));
        GroupChallengeBetParticipant mine = participantOf(bet, USER_ID);
        givenLeaveEntry(bet, mine);
        givenOpensAt(durationTarget(MissionCategory.FOCUS), null);
        given(groupChallengeBetRepository.compareAndSetSettled(
                eq(BET_ID), eq(GroupBetStatus.CANCELED), any())).willReturn(1);

        groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        verify(groupChallengeBetRepository)
                .compareAndSetSettled(eq(BET_ID), eq(GroupBetStatus.CANCELED), any());
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("bet:" + BET_ID + ":leave-refund:" + PARTICIPANT_ID));
    }

    @Test
    @DisplayName("마지막 참가자가 철회해도 챌린지는 건드리지 않는다 — 내기만 취소된다")
    void leaveBetKeepsChallengeWhenLastParticipantLeaves() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today().plusDays(1));
        givenLeaveEntry(bet, participantOf(bet, USER_ID));
        givenOpensAt(durationTarget(MissionCategory.FOCUS), null);
        given(groupChallengeBetRepository.compareAndSetSettled(
                eq(BET_ID), eq(GroupBetStatus.CANCELED), any())).willReturn(1);

        groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID);

        // 챌린지는 여러 날짜에 걸쳐 재사용되는 미션 템플릿이다. 하루치 판이 비었다고 참가자
        // 한 명의 철회로 그룹 공용 자산을 지우지 않는다 — 빈 챌린지 처리는 별도 티켓.
        verify(groupChallengeRepository, never())
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(any(), any());
        // 내기 자체의 취소·환불은 그대로 일어난다.
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("bet:" + BET_ID + ":leave-refund:" + PARTICIPANT_ID));
    }

    @Test
    @DisplayName("미참가자 철회 → BET_NOT_JOINED — 환불도 행 삭제도 없다")
    void leaveBetRejectsNonParticipant() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today().plusDays(1));
        givenLeaveEntry(bet, participantOf(bet, OTHER_USER_ID));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_JOINED);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never()).delete(any());
    }

    @Test
    @DisplayName("검증 순서 — 미참가 + 이미 종료면 BET_NOT_JOINED 가 먼저다(참가자 → OPEN → 시작 전)")
    void leaveBetChecksParticipationBeforeStatus() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.SETTLED, today().minusDays(1));
        givenLeaveEntry(bet, participantOf(bet, OTHER_USER_ID));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_JOINED);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("정산이 끝난 내기(SETTLED/FORFEITED) 철회 → BET_NOT_OPEN, 환불 없음")
    void leaveBetRejectsSettledBet() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.SETTLED, today().minusDays(1));
        givenLeaveEntry(bet, participantOf(bet, USER_ID));

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never()).delete(any());
    }

    @Test
    @DisplayName("DURATION 당일 내기 철회 → BET_LEAVE_CLOSED — 집계가 이미 진행 중이라 무를 수 없다")
    void leaveBetRejectsSameDayDurationBet() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        givenLeaveEntry(bet, participantOf(bet, USER_ID));
        givenOpensAt(durationTarget(MissionCategory.FOCUS), null);

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never()).delete(any());
    }

    @Test
    @DisplayName("창형(TIME_WINDOW) — 오늘 내기여도 창 시작 전이면 철회할 수 있다")
    void leaveBetAllowsWindowBetBeforeWindowStarts() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        GroupChallengeBetParticipant mine = participantOf(bet, USER_ID);
        givenLeaveEntry(bet, mine, participantOf(bet, OTHER_USER_ID));
        givenOpensAt(windowTarget(MissionCategory.FOCUS), oneHourLater());

        groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).delete(mine);
        verify(currencyLedgerService).credit(any(), eq(CurrencyTransactionType.BET_REFUND), eq(30),
                eq("bet:" + BET_ID + ":leave-refund:" + PARTICIPANT_ID));
    }

    @Test
    @DisplayName("창형 — 창이 이미 시작됐으면 BET_LEAVE_CLOSED (내일 내기라도 시작 시각이 기준이다)")
    void leaveBetRejectsWindowBetAfterWindowStarts() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today());
        givenLeaveEntry(bet, participantOf(bet, USER_ID));
        givenOpensAt(windowTarget(MissionCategory.FOCUS), oneHourAgo());

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertNoRefundIssued();
        verify(groupChallengeBetParticipantRepository, never()).delete(any());
    }

    @Test
    @DisplayName("없는 내기(또는 남의 그룹 내기) 철회 → BET_NOT_FOUND")
    void leaveBetRejectsUnknownBet() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> groupBetService.leaveBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertNoRefundIssued();
    }

    @Test
    @DisplayName("개설자가 이미 철회한 내기에 cancelBet — 남은 참가자 검사에 걸려 BET_CANCEL_HAS_OTHERS 로 거절")
    void cancelBetRejectsAfterCreatorAlreadyLeft() {
        givenMember();
        GroupChallengeBet bet = bet(GroupBetStatus.OPEN, today().plusDays(1));
        given(groupChallengeBetRepository.findByIdAndGroupIdForUpdate(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet));
        // 개설자(USER_ID)는 이미 철회해 참가 행이 없다 — 타인 행만 남은 상태.
        given(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(BET_ID)))
                .willReturn(List.of(participantOf(bet, OTHER_USER_ID)));

        assertThatThrownBy(() -> groupBetService.cancelBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        assertNoRefundIssued();
    }
}

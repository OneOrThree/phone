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
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.ZoneId;
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
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 내기 개설·참가 가드 단위 테스트.
 *
 * <p>돈이 걸리는 경로라 "거절되어야 할 때 확실히 거절되는가"가 핵심이다 — FOCUS+DURATION 제한,
 * 허용 판돈, 오늘 날짜, 중복 개설/참가, 이미 달성(무위험 참가), 마감, 잔액 부족.
 * 거절 시 <b>판돈이 차감되지 않는지</b>까지 함께 본다.
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
    private GroupChallengeDurationRepository groupChallengeDurationRepository;

    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;

    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private CurrencyLedgerService currencyLedgerService;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID BET_ID = UUID.fromString("00000000-0000-0000-0000-0000000000b1");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private static final int GOAL_MINUTES = 120;

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

    private void givenGoalMinutes() {
        given(groupChallengeDurationRepository.findById(CHALLENGE_ID))
                .willReturn(Optional.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID).durationMinutes(GOAL_MINUTES).build()));
    }

    /** 내기 날짜의 내 집중 기록. 목표(120분) 대비 달성/미달성을 만든다. */
    private void givenFocusMinutes(LocalDate date, int minutes) {
        given(dailyFocusStatRepository.findByUserIdInAndDate(List.of(USER_ID), date))
                .willReturn(List.of(DailyFocusStat.builder()
                        .user(member()).date(date).totalFocusSeconds(minutes * 60).build()));
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
    @DisplayName("개설 성공 → 내기 저장 + 개설자 자동 참가 + 판돈 차감(멱등키 bet:{betId}:stake:{userId})")
    void createBetChargesStakeAndAutoJoinsCreator() {
        givenMember();
        givenChallenge(focusChallenge());
        givenGoalMinutes();
        givenFocusMinutes(today(), 10);
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
        assertThat(key.getValue()).isEqualTo("bet:" + BET_ID + ":stake:" + USER_ID);
    }

    @Test
    @DisplayName("허용 판돈(10/30/50/100) 밖 → BET_INVALID_STAKE, 차감 없음")
    void createBetRejectsUnlistedStake() {
        givenMember();

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(15, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_INVALID_STAKE);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("오늘(KST)이 아닌 날짜 → BET_CLOSED — 지난 날짜는 결과가 정해졌고 미래는 배치 전제를 깬다")
    void createBetRejectsNonTodayDate() {
        givenMember();

        assertThatThrownBy(() -> groupBetService.createBet(
                GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today().minusDays(1))))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("SCREEN_TIME 챌린지 → BET_FOCUS_ONLY — 클라 신뢰 달성에는 돈을 걸 수 없다")
    void createBetRejectsScreenTimeChallenge() {
        givenMember();
        givenChallenge(challenge(MissionCategory.SCREEN_TIME, MissionType.DURATION));

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_FOCUS_ONLY);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("TIME_WINDOW 챌린지 → BET_FOCUS_ONLY — 달성 판정 자체가 아직 없다")
    void createBetRejectsTimeWindowChallenge() {
        givenMember();
        givenChallenge(challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW));

        assertThatThrownBy(() ->
                groupBetService.createBet(GROUP_ID, CHALLENGE_ID, USER_ID, request(30, today())))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_FOCUS_ONLY);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("같은 챌린지·같은 날짜에 이미 내기가 있으면 → BET_ALREADY_EXISTS")
    void createBetRejectsDuplicateForSameChallengeAndDate() {
        givenMember();
        givenChallenge(focusChallenge());
        givenGoalMinutes();
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
        givenGoalMinutes();
        given(groupChallengeBetRepository.existsByChallengeIdAndBetDate(CHALLENGE_ID, today()))
                .willReturn(false);
        givenFocusMinutes(today(), GOAL_MINUTES);   // 목표와 동일 = 달성

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
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenGoalMinutes();
        givenFocusMinutes(today(), 30);

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(groupChallengeBetParticipantRepository).save(any());
        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30),
                eq("bet:" + BET_ID + ":stake:" + USER_ID));
    }

    @Test
    @DisplayName("없는 내기(또는 남의 그룹 내기) → BET_NOT_FOUND")
    void joinBetRejectsUnknownBet() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
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
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
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
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today().minusDays(1))));

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("중복 참가 → BET_ALREADY_JOINED, 이중 차감 없음")
    void joinBetRejectsDuplicateJoin() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
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
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenGoalMinutes();
        givenFocusMinutes(today(), GOAL_MINUTES + 5);

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_ACHIEVED);
        assertNoStakeCharged();
    }

    @Test
    @DisplayName("잔액 부족 → INSUFFICIENT_CURRENCY 전파 (트랜잭션 롤백으로 참가 행도 남지 않는다)")
    void joinBetPropagatesInsufficientCurrency() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenGoalMinutes();
        givenFocusMinutes(today(), 0);
        willThrow(new CurrencyException(CurrencyErrorCode.INSUFFICIENT_CURRENCY))
                .given(currencyLedgerService).debit(any(), any(), anyInt(), anyString());

        assertThatThrownBy(() -> groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID))
                .isInstanceOf(CurrencyException.class)
                .hasFieldOrPropertyWithValue("errorCode", CurrencyErrorCode.INSUFFICIENT_CURRENCY);
    }

    @Test
    @DisplayName("집중 기록이 아예 없으면 0분으로 보고 참가를 허용한다")
    void joinBetTreatsMissingStatAsZeroMinutes() {
        givenMember();
        given(groupChallengeBetRepository.findByIdAndGroupId(BET_ID, GROUP_ID))
                .willReturn(Optional.of(bet(GroupBetStatus.OPEN, today())));
        given(groupChallengeBetParticipantRepository.existsByBetIdAndUserId(BET_ID, USER_ID))
                .willReturn(false);
        givenGoalMinutes();
        given(dailyFocusStatRepository.findByUserIdInAndDate(List.of(USER_ID), today()))
                .willReturn(List.of());

        groupBetService.joinBet(GROUP_ID, BET_ID, USER_ID);

        verify(currencyLedgerService).debit(any(), eq(CurrencyTransactionType.BET_STAKE), eq(30), anyString());
    }
}

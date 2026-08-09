package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetHistoryItemResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.dto.GroupBetParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.dto.GroupBetResultParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResultResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 그룹 챌린지 내기의 개설·참가와 조회용 조립.
 *
 * <p>정산은 {@link GroupBetSettlementService}(배치 진입점)와 {@link GroupBetSettler}(내기 단위
 * 트랜잭션)가 맡는다 — 여기서는 유저 요청 경로와, 그 경로들과 <b>환불 키·잠금 규율을 공유해야만
 * 하는</b> 처분 하나({@link #refundFrozenBet} — 24h 동결 자동 환불)를 다룬다.
 *
 * <p>참가비 차감은 {@link CurrencyLedgerService#debit} 로 하며 멱등키
 * {@code bet:{betId}:stake:{participantId}} 를 함께 남긴다 — 축이 유저가 아니라 <b>참가 행</b>인
 * 이유는 {@link #stakeIn} 참고(계약 §2-2, GROMO-1112).
 *
 * <p><b>환불도 같은 축이다</b>(GROMO-1258) — 취소·철회·탈퇴 연동·24h 자동 환불이 전부
 * {@code bet:{betId}:refund:{participantId}} 하나를 쓴다({@link #refundKey}). 차감과 1:1 로
 * 대응하므로 "한 번 걷힌 참가 행은 어떤 경로로든 정확히 한 번만 돌아온다"를 원장 유니크
 * ({@code uq_currency_transactions_idempotency_key})가 경로와 무관하게 보장한다(정책 §C9).
 * 종전에는 철회만 {@code :leave-refund:{participantId}} 로 축이 갈려 있어 두 키가 서로를 못 막았고,
 * 철회 × 그룹 탈퇴가 겹치면 같은 판돈이 두 번 나갔다. 정산 지급 키({@code :payout:{userId}})는
 * 내기당 유저 1회뿐이라 유저 축 그대로다({@link GroupBetSettler#payoutKey}). 잔액은
 * {@code UserWallet} 의 @Version 낙관락이, 중복 참가·중복 개설은 DB 유니크 제약이 각각
 * 최후 방어선이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupBetService {

    /**
     * 참가비 허용 범위 — 정수 1~1000 (계약 §2, GROMO-1097). 고정 프리셋(10/30/50/100)에서
     * 자유 입력으로 확대됐다 — 프리셋은 앱의 빠른 선택 칩으로만 남는다. 상한은 오입력·과몰입
     * 방지용 정책 값이고, DB 제약은 {@code stake > 0} 그대로다(스키마 변경 없음).
     */
    static final int MIN_STAKE = 1;
    static final int MAX_STAKE = 1000;

    /** 내기 히스토리 페이지 크기 상한 — 집중 세션 슬라이스({@code FocusService})와 같은 값. */
    static final int MAX_HISTORY_PAGE_SIZE = 100;

    /**
     * 히스토리에 실리는 status — 정산 결과 3종만. CANCELED 는 "없던 일"이라 이력에서도 뺀다
     * ({@code findLatestSettledByChallengeIds} 의 허용 목록과 같은 규칙). REFUNDED 는 24h 동결
     * 자동 환불({@link #refundFrozenBet}, 정책 §E1)이 만드는 현역 상태다 — GROMO-1258 이전에는
     * 생성 코드가 없는 레거시라 deprecated 였다.
     */
    private static final List<GroupBetStatus> HISTORY_STATUSES =
            List.of(GroupBetStatus.SETTLED, GroupBetStatus.REFUNDED, GroupBetStatus.FORFEITED);

    /**
     * 탈퇴 유저 표시 문구 (GROMO-1220, 결정 D1) — 탈퇴는 소프트딜리트라 nickname 이 파기(null)되는데,
     * 정산 명단·히스토리는 참가 행이 이력으로 영구 보존되어 빈 닉네임이 그대로 노출된다. 명단에서
     * <b>제거하지 않고 치환만</b> 하는 이유: pot = stake × 원본 participants.size() 라(계약 §1)
     * 행을 빼면 인원·금액이 실제 정산과 어긋난다.
     */
    static final String WITHDRAWN_USER_NICKNAME = "탈퇴한 사용자";

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final CurrencyLedgerService currencyLedgerService;
    private final GroupBetJudge groupBetJudge;

    // ── 개설 / 참가 ──────────────────────────────────────────────────────

    /**
     * 내기 개설. 그룹원 누구나 개설할 수 있고 개설자는 자동 참가(판돈 즉시 차감)한다.
     *
     * <p>대상은 <b>목표분이 있는 모든 챌린지</b>다 — FOCUS·SCREEN_TIME × DURATION·TIME_WINDOW 4조합
     * (창은 목표분이 있는 것만). SCREEN_TIME 은 클라 신뢰 데이터로 재화가 움직이는 리스크를 수용한
     * 확정 정책이다. 조합별 판정 소스는 {@link GroupBetJudge} 하나가 쥔다.
     */
    @Transactional
    public CreateBetResponse createBet(UUID groupId, UUID challengeId, UUID userId, CreateBetRequest request) {
        User user = requireActiveUser(userId);
        Group group = requireGroupMembership(user, groupId);

        int stake = request.getStake();
        if (stake < MIN_STAKE || stake > MAX_STAKE) {
            throw new GroupException(GroupErrorCode.BET_INVALID_STAKE);
        }
        // 내기는 "오늘 또는 내일"(KST)에만 걸 수 있다(계약 §3, GROMO-1103) — 지난 날짜는 결과가
        // 이미 정해졌고, 모레 이후는 앱이 만들 수 없는 값이다. 내일 내기는 창(시간대)이 이미 끝난 뒤
        // "내일 시간대부터 적용" 경로로 열린다. 정산 배치(GroupBetSettlementService)는
        // bet_date < 기준일만 대상으로 집으므로 미래 내기가 조기 정산·몰수되는 일은 없다
        // (GroupBetSettlementIntegrationTest 가 고정한다).
        LocalDate betDate = request.getDate();
        LocalDate today = today();
        if (!betDate.equals(today) && !betDate.equals(today.plusDays(1))) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }

        // 챌린지 행을 잠그고 읽는다 — 삭제(deleteChallenge)와 직렬화하기 위해서다. 락이 없으면
        // "OPEN 내기가 없다"고 본 삭제와 이 개설이 겹쳐, 판돈이 걸린 내기가 삭제된 챌린지에 매달린다.
        GroupChallenge challenge = groupChallengeRepository
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        // 종료된 챌린지에는 돈을 걸 수 없다. deleted_at 만으로는 부족하다 — V2 마이그레이션이 레거시
        // ENDED 챌린지를 INACTIVE 로 이관해 뒀고(삭제는 아니라 목록에도 그대로 뜬다), 중복 검사는
        // ACTIVE 만 보므로 같은 그룹에 활성 챌린지와 INACTIVE 챌린지가 공존한다. 그 id 로 개설하면
        // 아무도 진행하지 않는 챌린지에 판돈이 묶인다 (PR #381 리뷰).
        if (challenge.getStatus() != GroupChallengeStatus.ACTIVE) {
            throw new GroupException(GroupErrorCode.BET_CHALLENGE_INACTIVE);
        }
        // 게이트 = DURATION || (TIME_WINDOW && 창 목표분 있음). 카테고리 제한은 없다.
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge)
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
        // 창 마감 검사는 오늘 내기에만 건다 — 내일 창은 아직 시작도 안 했으니 항상 열려 있다
        // (계약 §3: date=내일은 TIME_WINDOW·DURATION 공통 무조건 허용).
        if (betDate.equals(today)) {
            requireWindowStillOpen(target, betDate);
        }

        // 취소(CANCELED)는 "없던 일" — 같은 날짜 재개설을 막지 않는다(GROMO-1201). 비취소 내기만
        // 중복으로 본다. 레이스의 최후 방어선은 V28 부분 유니크 인덱스(아래 catch 로 강하)다.
        if (groupChallengeBetRepository.existsByChallengeIdAndBetDateAndStatusNot(
                challengeId, betDate, GroupBetStatus.CANCELED)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_EXISTS);
        }
        requireEligibleToStake(target, user, betDate);

        GroupChallengeBet bet;
        try {
            // saveAndFlush — INSERT 를 지금 내보내야 부분 유니크 위반이 이 try 안에서 잡힌다
            // (save 만 하면 위반이 커밋 시점에 터져 아래 강하를 지나친다).
            bet = groupChallengeBetRepository.saveAndFlush(GroupChallengeBet.builder()
                    .group(group)
                    .challenge(challenge)
                    .creatorUser(user)
                    .stake(stake)
                    .betDate(betDate)
                    .status(GroupBetStatus.OPEN)
                    .build());
        } catch (DataIntegrityViolationException e) {
            // 사전 검사와 동시 개설이 겹친 레이스 — 부분 유니크(비취소 챌린지·날짜당 1개) 위반을
            // 결정적인 409 로 강하한다(GroupChallengeService 의 CHALLENGE_DUPLICATE 강하와 같은 관행).
            // 이 시점엔 판돈이 아직 걷히지 않았다(stakeIn 전)라 되돌릴 돈도 없다.
            throw new GroupException(GroupErrorCode.BET_ALREADY_EXISTS);
        }
        stakeIn(bet, user);

        log.info("내기 개설 — betId={}, challengeId={}, betDate={}, stake={}, creator={}",
                bet.getId(), challengeId, betDate, bet.getStake(), userId);
        return CreateBetResponse.builder().betId(bet.getId()).build();
    }

    /** 진행 중(OPEN·오늘 또는 내일) 내기에 참가한다. 판돈은 즉시 차감된다. */
    @Transactional
    public void joinBet(UUID groupId, UUID betId, UUID userId) {
        User user = requireActiveUser(userId);
        requireGroupMembership(user, groupId);

        // 행 잠금 — "OPEN 확인 → 참가 행 삽입 + 차감"이 check-then-act 라, 잠금 없이는 그 사이에
        // 취소(명시적·탈퇴 자동)가 끼어들어 방금 종료된 내기에 참가자의 판돈이 묶인다 (PR #427 리뷰).
        GroupChallengeBet bet = groupChallengeBetRepository.findByIdAndGroupIdForUpdate(betId, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        // 정산됐거나(status≠OPEN) 날짜가 지난 내기는 닫힌 것으로 본다. 배치가 돌기 전(FOCUS 01:00 /
        // SCREEN_TIME 12:00 KST 이전)의 전일자 내기가 여기 걸린다 — status 만으로는 못 막는 구간이라
        // 날짜도 함께 본다. 미래(내일) 내기는 참가를 허용한다(GROMO-1103 — 마감 후 열린 내일 내기에
        // 오늘 밤 합류할 수 있어야 한다). 창형은 오늘 내기라도 창이 끝났으면 아래 창 검사가 막고,
        // 내일 내기의 창 마감 시각은 항상 미래라 자연히 통과한다.
        if (!bet.isOpen() || bet.getBetDate().isBefore(today())) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }
        if (groupChallengeBetParticipantRepository.existsByBetIdAndUserId(betId, userId)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_JOINED);
        }
        GroupBetJudge.Target target = groupBetJudge.resolve(bet.getChallenge())
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
        requireWindowStillOpen(target, bet.getBetDate());
        requireEligibleToStake(target, user, bet.getBetDate());

        stakeIn(bet, user);
        log.info("내기 참가 — betId={}, userId={}, stake={}", betId, userId, bet.getStake());
    }

    // ── 취소 / 그룹 탈퇴 연동 ────────────────────────────────────────────

    /**
     * 내기 취소 — 개설자 본인이면서 참가자가 개설자 1명뿐인 OPEN 내기만 가능하다. 판돈은 환불된다.
     *
     * <p>타인이 참가한 내기를 취소로 무를 수 있으면 "질 것 같으면 무르기"가 되므로 단독일 때만
     * 허용한다. 진입 조회가 행 잠금이라 참가(joinBet)와 직렬화된다 — 잠금 없이는 "단독 확인 →
     * 취소" 사이에 참가가 끼어들어 방금 취소된 내기에 참가자의 판돈이 묶인다. 상태 전이는 정산과
     * 같은 CAS 게이트를 지난다 — 검증과 전이 사이에 정산 배치가 먼저 끝냈으면 CAS 가 0행을
     * 돌려주고, 이 취소는 {@code BET_NOT_OPEN} 으로 거절된다(환불 없음). 환불 멱등키는 모든 환불
     * 경로가 공유하는 참가 행 축({@link #refundKey})이라 이중 환불은 원장 유니크가 최후 방어한다.
     */
    @Transactional
    public void cancelBet(UUID groupId, UUID betId, UUID userId) {
        User user = requireActiveUser(userId);
        requireGroupMembership(user, groupId);

        GroupChallengeBet bet = groupChallengeBetRepository.findByIdAndGroupIdForUpdate(betId, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        if (!bet.getCreatorUser().getId().equals(userId)) {
            throw new GroupException(GroupErrorCode.BET_CANCEL_FORBIDDEN);
        }
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findByBetIdIn(List.of(betId));
        if (participants.stream().anyMatch(p -> !p.getUser().getId().equals(userId))) {
            throw new GroupException(GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        }
        // 이미 종료된 내기(이중 취소 포함)의 이른 거절. 레이스는 아래 CAS 가 최종 판정한다.
        if (!bet.isOpen()) {
            throw new GroupException(GroupErrorCode.BET_NOT_OPEN);
        }

        int claimed = groupChallengeBetRepository.compareAndSetSettled(
                betId, GroupBetStatus.CANCELED, Instant.now());
        if (claimed == 0) {
            throw new GroupException(GroupErrorCode.BET_NOT_OPEN);
        }
        // 환불 키의 축이 참가 행이므로(GROMO-1258) 개설자 본인 행을 집어 돌려준다. 행이 없다는 것은
        // 걷힌 판돈도 없다는 뜻이라 환불 대상이 아니다 — 위 "타인 참가 없음" 검사를 통과한 채로 이
        // 상태가 되려면 참가자 0명이어야 하는데, 마지막 참가자 철회가 이미 CANCELED 로 닫으므로
        // 정상 흐름에는 없다(방어적 분기).
        participants.stream()
                .filter(p -> p.getUser().getId().equals(userId))
                .findFirst()
                .ifPresentOrElse(
                        mine -> refundParticipant(bet, mine),
                        () -> log.warn("내기 취소 — 개설자 참가 행이 없어 환불 없이 닫는다. betId={}, userId={}",
                                betId, userId));

        log.info("내기 취소 — betId={}, challengeId={}, userId={}, stake={} 환불",
                betId, bet.getChallenge().getId(), userId, bet.getStake());
    }

    /**
     * 참가 철회(GROMO-1102) — <b>시작 전</b>인 OPEN 내기에서 호출자 본인의 참가만 무르고 본인
     * 판돈을 환불한다. 개설자도 철회할 수 있고 남은 참가자가 있으면 내기는 유지된다
     * ({@code creatorUserId} 는 이력으로 남는다). 마지막 참가자가 떠나면 내기는 자동 취소된다.
     *
     * <p>"시작 전" 판정은 조합별로 다르다 — TIME_WINDOW 는 현재가 {@code bet_date} 창의 시작 시각
     * ({@link WindowFocusAggregator#windowStartOn} 경유) 전이어야 하고, DURATION 은 하루 전체가
     * 판이라 {@code bet_date} 가 내일 이후(KST)여야 한다(당일은 집계가 이미 진행 중이다). 시작
     * 이후의 철회는 "질 것 같으면 무르기"가 되므로 막는다.
     *
     * <p>정산 배치는 전일자만 집고 철회는 미래 시작만 허용하므로 날짜 게이트만으로도 서로
     * 배타적이지만, 진입 조회를 행 잠금으로 두어 참가·취소·정산·탈퇴 연동과 구조적으로 직렬화한다.
     * 마지막 참가자의 CANCELED 전이는 정산·취소와 같은 CAS 게이트({@link #claimCanceled})를
     * 지나고, 환불 멱등키는 차감과 같은 축(참가 행 id)의 공용 환불 키({@link #refundKey})라
     * 이중 환불은 원장 유니크가 최후 방어한다.
     */
    @Transactional
    public void leaveBet(UUID groupId, UUID betId, UUID userId) {
        User user = requireActiveUser(userId);
        requireGroupMembership(user, groupId);

        GroupChallengeBet bet = groupChallengeBetRepository.findByIdAndGroupIdForUpdate(betId, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findByBetIdIn(List.of(betId));
        // 검증 순서 계약(§4): 참가자 여부 → OPEN → 시작 전.
        GroupChallengeBetParticipant mine = participants.stream()
                .filter(p -> p.getUser().getId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_JOINED));
        if (!bet.isOpen()) {
            throw new GroupException(GroupErrorCode.BET_NOT_OPEN);
        }
        requireBeforeStart(bet);

        groupChallengeBetParticipantRepository.delete(mine);
        boolean lastParticipant = participants.size() == 1;
        if (lastParticipant) {
            claimCanceled(bet);
        }
        refundParticipant(bet, mine);
        log.info("내기 참가 철회 — betId={}, userId={}, stake={} 환불, 자동취소={}",
                betId, userId, bet.getStake(), lastParticipant);
    }

    /**
     * 시작 전 가드(철회) — 판정은 {@link #isBeforeStart} 가 하고 여기서는 거절만 한다.
     * 목표를 해석할 수 없는 내기는 개설 게이트({@code resolve})가 이미 막았으므로 여기 도달하면
     * 데이터가 깨진 것이다 — 개설·참가와 같은 코드로 방어적으로 거절한다(탈퇴 연동은 예외 대신
     * 스킵한다 — {@link #releaseBets}).
     */
    private void requireBeforeStart(GroupChallengeBet bet) {
        GroupBetJudge.Target target = groupBetJudge.resolve(bet.getChallenge())
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
        if (!isBeforeStart(target, bet)) {
            throw new GroupException(GroupErrorCode.BET_LEAVE_CLOSED);
        }
    }

    /**
     * "이 회차는 아직 시작 전인가" — TIME_WINDOW 는 창 시작 시각, DURATION 은 날짜 경계(KST)가
     * 시작점이다. 철회({@link #requireBeforeStart})와 <b>그룹 탈퇴</b> 연동({@link #releaseBets})이
     * <b>같은 판정</b>을 공유해야 한다(GROMO-1258): 갈라지면 "철회는 막혔는데 그룹을 나가면
     * 환불된다"는 우회로가 생겨 §C8("시작한 회차에서는 어떤 경로로도 참가비를 뺄 수 없다")과
     * 손실 회피 설계가 통째로 무력화된다. 계정 탈퇴는 이 가드를 타지 않는다 — 이유는
     * {@link ReleaseReason#ACCOUNT_WITHDRAW}.
     *
     * <p>목표를 해석할 수 없으면 <b>시작된 것으로 본다</b>(false). 시작 여부를 모르는 채 환불하는
     * 것보다 에스크로에 남기는 쪽이 안전하고, 그렇게 묶인 판돈은 24h 자동 환불
     * ({@link #refundFrozenBet}, 정책 §E1)이 최후에 풀어 준다.
     */
    private boolean isBeforeStart(GroupChallengeBet bet) {
        return groupBetJudge.resolve(bet.getChallenge())
                .map(target -> isBeforeStart(target, bet))
                .orElse(false);
    }

    private boolean isBeforeStart(GroupBetJudge.Target target, GroupChallengeBet bet) {
        Optional<Instant> opensAt = groupBetJudge.windowOpensAt(target, bet.getBetDate());
        if (opensAt.isPresent()) {
            return Instant.now().isBefore(opensAt.get());
        }
        // DURATION 은 하루 전체가 판이라 자정이 시작점이다 — 당일 내기는 이미 집계가 돌고 있다.
        return bet.getBetDate().isAfter(today());
    }

    /**
     * 그룹 탈퇴 연동 — 탈퇴자가 참가 중인 OPEN 내기에서 빼고 판돈을 환불한다.
     * {@link GroupMemberService#withdrawGroup} 가 탈퇴와 <b>같은 트랜잭션</b>에서 호출한다
     * (탈퇴만 되고 판돈이 묶이는 반쪽 상태 방지).
     *
     * <p>대상은 <b>시작 전 회차뿐</b>이다({@link ReleaseReason#GROUP_LEAVE}) — 시작된 회차는
     * 손대지 않고 정산 대상으로 남긴다.
     *
     * <ul>
     *   <li>탈퇴자가 개설자 → 내기 전체 취소(CANCELED) + 전원 환불</li>
     *   <li>탈퇴자가 일반 참가자 → 참가 행 삭제 + 본인 환불. 남은 참가자가 개설자 1명뿐이면
     *       자동 취소 + 개설자 환불(혼자 남은 내기는 성립하지 않는다)</li>
     * </ul>
     *
     * <p>내기마다 행 잠금(FOR UPDATE)으로 시작한다 — 정산 배치({@link GroupBetSettler})·참가
     * ({@link #joinBet})와 같은 잠금을 잡으므로 "정산이 참가자를 읽는 사이의 행 삭제·환불"이나
     * "단독 확인 → 자동 취소 사이의 참가 끼어들기" 같은 레이스가 원천 차단된다. 잠금 후 status
     * 재확인에서 이미 종료된 내기는 건드리지 않는다(정산 결과 존중).
     *
     * <p><b>불변식: 그룹 상태(ENDED 등)를 보지 않는다</b> — 내기 status 만이 게이트다. 계정 탈퇴
     * ({@code UserService.withdraw}, GROMO-801)가 solo 방장 그룹을 {@code close()} 한 <b>뒤에</b>
     * 이 메서드를 호출하는 것이 이 불변식에 기대므로, 그룹 상태 검사를 새로 넣으면 안 된다.
     */
    @Transactional
    public void releaseFromOpenBets(User user, Group group) {
        releaseBets(groupChallengeBetRepository
                        .findOpenBetIdsByGroupIdAndParticipantUserId(group.getId(), user.getId()),
                user, ReleaseReason.GROUP_LEAVE);
    }

    /**
     * 계정 탈퇴 연동(GROMO-801) — 탈퇴자가 참가 중인 <b>모든 그룹</b>의 OPEN 내기를 한 번에
     * 정리한다. {@code UserService.withdraw} 가 탈퇴와 같은 트랜잭션에서 호출한다.
     *
     * <p>그룹·멤버십 스코프가 아니라 <b>참가 행 스코프</b>인 이유 두 가지:
     * <ul>
     *   <li>강퇴({@code kickMember})는 참가·판돈을 정산용으로 남기므로, 활성 멤버십이 없는
     *       강퇴자도 OPEN 내기의 참가자다 — 멤버십 경유 조회로는 놓치고 판돈이 소각된다</li>
     *   <li>그룹 단위 순차 해제는 앞 그룹의 환불로 지갑 행 잠금을 쥔 채 다음 그룹의 내기 잠금을
     *       기다리게 되어, 반대 순서로 잠그는 정산기와 AB-BA 교착이 된다 — 전 그룹의 대상 내기
     *       행을 bet id 오름차순으로 전부 잠근 뒤에만 돈을 움직인다</li>
     * </ul>
     *
     * <p>{@link #releaseFromOpenBets(User, Group)} 와 같은 2단계 잠금 규율·불변식(그룹 상태
     * 불참조)을 공유하지만, <b>"시작된 회차는 남긴다" 가드는 공유하지 않는다</b> —
     * {@link ReleaseReason#ACCOUNT_WITHDRAW} 참고.
     */
    @Transactional
    public void releaseFromAllOpenBets(User user) {
        releaseBets(groupChallengeBetRepository.findOpenBetIdsByParticipantUserId(user.getId()),
                user, ReleaseReason.ACCOUNT_WITHDRAW);
    }

    /**
     * 해제 경로 — 같은 {@link #releaseBets} 를 쓰지만 <b>이미 시작된 회차</b>의 처분이 갈린다.
     * 갈라야 하는 이유는 두 경로가 남기는 뒷일이 다르기 때문이다(GROMO-1258 리뷰).
     */
    private enum ReleaseReason {
        /**
         * 그룹 탈퇴({@link GroupMemberService#withdrawGroup}) — 시작된 회차는 <b>손대지 않는다</b>.
         * 탈퇴자의 계정·지갑·집중 통계가 전부 살아 있으므로 정산이 그대로 판정·지급할 수 있고,
         * 여기서 환불해 주면 "지는 판이 시작된 뒤 그룹을 나가면 전액 환불"이라는 우회로가 열려
         * 철회 가드({@link #requireBeforeStart})가 통째로 무력화된다(정책 §C8).
         */
        GROUP_LEAVE,
        /**
         * 계정 탈퇴({@code UserService.withdraw}) — 시작된 회차에서도 <b>탈퇴자 본인만 분리</b>한다.
         * 근거 두 가지:
         * <ul>
         *   <li>우회 유인이 없다 — 계정 탈퇴의 환불금은 같은 트랜잭션에서 삭제되는 지갑
         *       ({@code userWalletRepository.deleteById})으로 들어가 그대로 소멸한다. "환불받고
         *       빠져나간다"가 성립하지 않으므로 §C8 가드가 막을 대상 자체가 없다</li>
         *   <li>판정 근거가 같은 트랜잭션에서 파기된다 — {@code UserService.withdraw} 는 해제
         *       직후 {@code focus_sessions}·{@code daily_focus_stats}·{@code daily_screen_time_stats}
         *       를 전부 {@code user = null} 로 익명화하는데, 이 셋이 정확히
         *       {@link GroupBetJudge#progressMinutes} 의 판정 소스다. 참가 행을 남겨 두면 나중 정산이
         *       달성자를 0분·미보고로 읽어 <b>미달성으로 오판</b>하고, 그 거짓 기록이
         *       {@code recordSettlement} 로 영구히 박힌다(남은 참가자에게 "탈퇴한 사용자 — 실패"로
         *       노출된다). 판정할 수 없는 참가자는 정산에 남기지 않는 것이 맞다</li>
         * </ul>
         */
        ACCOUNT_WITHDRAW
    }

    private void releaseBets(List<UUID> betIds, User user, ReleaseReason reason) {
        // 1단계: 대상 내기 행을 id 오름차순으로 전부 잠근다 — 지갑 쓰기 없이 잠금만. 내기 하나를
        // 정리(지갑 쓰기)한 채로 다음 내기 잠금을 기다리면, 그 내기를 이미 잠근 참가/정산이 이쪽이
        // 쥔 지갑을 기다리는 AB-BA 데드락이 된다. 모든 경로의 잠금 순서를 "내기 행(전부) → 지갑"으로
        // 고정하기 위해 잠금 확보를 먼저 끝낸다. 잠금 시점에 이미 종료된 내기는 정산 결과를 존중해
        // 제외한다(대상 조회와 잠금 사이에 정산·취소가 먼저 끝난 판).
        List<GroupChallengeBet> lockedOpenBets = new ArrayList<>();
        for (UUID betId : betIds) {
            groupChallengeBetRepository.findByIdForUpdate(betId)
                    .filter(GroupChallengeBet::isOpen)
                    .ifPresent(lockedOpenBets::add);
        }

        // 2단계: 잠금이 전부 확보된 뒤에만 돈을 움직인다(참가 해제·환불·자동 취소).
        for (GroupChallengeBet bet : lockedOpenBets) {
            boolean beforeStart = isBeforeStart(bet);
            // 그룹 탈퇴에 한해 이미 시작된 회차는 손대지 않는다(정책 §C8, GROMO-1258) — 참가 행·
            // 판돈을 그대로 두어 정산 대상으로 남긴다(판정도 지급도 그대로, 명단에는
            // WITHDRAWN_USER_NICKNAME 로 표기). 종전에는 여기에 시작 시각 가드가 아예 없어, "지는
            // 판이 시작된 뒤 그룹을 나가면 전액 환불"이라는 우회로로 철회 가드(requireBeforeStart)가
            // 통째로 무력화됐다. 계정 탈퇴는 이 가드를 타지 않는다(ReleaseReason.ACCOUNT_WITHDRAW).
            // 예외가 아니라 스킵인 이유: 탈퇴 자체는 막지 않는다 — 던지면 "지는 판이 하나라도 있으면
            // 그룹을 못 나간다"가 된다.
            if (!beforeStart && reason == ReleaseReason.GROUP_LEAVE) {
                log.info("내기 탈퇴 연동 스킵 — 이미 시작된 회차라 정산 대상으로 남긴다. "
                        + "betId={}, betDate={}, userId={}", bet.getId(), bet.getBetDate(), user.getId());
                continue;
            }
            List<GroupChallengeBetParticipant> participants =
                    groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId()));
            // 개설자 특권(회차 통째 취소)은 시작 전에만 의미가 있다(정책 §C8). 시작된 회차를
            // 취소하면 정상 판정이 가능한 남은 참가자들의 진행 중인 내기를 파괴하므로, 계정 탈퇴가
            // 시작된 회차에 들어오면 개설자여도 본인 참가 행만 분리한다 — 이미 시작된 회차에서
            // 개설자 여부는 처분을 가르지 않는다.
            if (beforeStart && bet.getCreatorUser().getId().equals(user.getId())) {
                cancelAndRefundAll(bet, participants);
            } else {
                detachAndRefund(bet, participants, user, beforeStart);
            }
        }
    }

    /**
     * 개설자 탈퇴(<b>시작 전 회차만</b>) — 내기 전체를 취소하고 전원(개설자 포함) 환불한다.
     * 환불은 userId 오름차순 — 여러 지갑을 만지는 경로(정산 지급 포함)끼리 지갑 잠금 순서를
     * 맞춰 두기 위한 고정이다.
     */
    private void cancelAndRefundAll(GroupChallengeBet bet, List<GroupChallengeBetParticipant> participants) {
        claimCanceled(bet);
        participants.stream()
                .sorted(Comparator.comparing(p -> p.getUser().getId()))
                .forEach(p -> refundParticipant(bet, p));
        log.info("내기 자동 취소 — 시작 전 회차의 개설자 탈퇴. betId={}, creatorId={}, 환불 {}명",
                bet.getId(), bet.getCreatorUser().getId(), participants.size());
    }

    /**
     * 참가 행 분리 — 탈퇴자 행 삭제 + 본인 환불. <b>시작 전</b> 회차에 한해 개설자 혼자 남으면
     * 자동 취소까지 한다.
     *
     * @param beforeStart 이 회차가 아직 시작 전인가. 시작된 회차(계정 탈퇴만 여기 온다)에서는
     *                    자동 취소를 하지 않는다 — 남은 참가자는 판정도 지급도 정상이라 회차를
     *                    닫을 이유가 없고, 닫으면 시작된 회차에서 참가비가 빠져나가 §C8 이 깨진다
     *                    (개설자와 짜고 한 명이 계정을 지우면 진 판이 전액 환불되는 우회로가 된다)
     */
    private void detachAndRefund(
            GroupChallengeBet bet, List<GroupChallengeBetParticipant> participants, User leaver,
            boolean beforeStart) {
        // 잠금 확보 후의 참가 행 재검증(GROMO-1258) — 대상 betId 는 잠금 <b>전에</b> 평문 SELECT 로
        // 뽑히므로(releaseFromOpenBets/releaseFromAllOpenBets), 그 사이에 같은 유저의 철회(leaveBet)가
        // 먼저 커밋되면 이 시점의 참가 행은 이미 없다. 종전에는 필터가 0건이어도 무조건 환불해
        // 같은 판돈이 두 번 나갔다(원장에는 축이 다른 두 키가 정상 기입으로 남아 탐지도 안 됐다).
        // 해제할 참가 행이 없으면 이 내기는 통째로 건너뛴다 — 이 탈퇴가 풀어 줄 판돈이 없다.
        Optional<GroupChallengeBetParticipant> mine = participants.stream()
                .filter(p -> p.getUser().getId().equals(leaver.getId()))
                .findFirst();
        if (mine.isEmpty()) {
            log.info("내기 참가 해제 스킵 — 잠금 시점에 참가 행이 없다(철회가 먼저 커밋됨). "
                    + "betId={}, userId={}", bet.getId(), leaver.getId());
            return;
        }
        groupChallengeBetParticipantRepository.delete(mine.get());

        List<GroupChallengeBetParticipant> remaining = participants.stream()
                .filter(p -> !p.getUser().getId().equals(leaver.getId()))
                .toList();
        boolean creatorAlone = beforeStart
                && remaining.size() == 1
                && remaining.get(0).getUser().getId().equals(bet.getCreatorUser().getId());
        if (!creatorAlone) {
            refundParticipant(bet, mine.get());
            log.info("내기 참가 해제 — 탈퇴 연동. betId={}, userId={}, stake={} 환불, 시작전={}",
                    bet.getId(), leaver.getId(), bet.getStake(), beforeStart);
            return;
        }

        // 자동 취소 — 탈퇴자·개설자 환불 2건도 userId 오름차순으로 고정한다. "탈퇴자 먼저" 고정이면
        // 탈퇴자 UUID 가 더 클 때 지갑 잠금이 내림차순이 되어, 오름차순으로 도는 다른 지갑-다중
        // 경로(전원 환불·정산 지급·반대 방향 탈퇴)와 교차 데드락이 성립한다 (PR #427 리뷰).
        claimCanceled(bet);
        Stream.of(mine.get(), remaining.get(0))
                .sorted(Comparator.comparing(p -> p.getUser().getId()))
                .forEach(p -> refundParticipant(bet, p));
        log.info("내기 참가 해제 — 탈퇴 연동. betId={}, userId={}, stake={} 환불, 시작전=true",
                bet.getId(), leaver.getId(), bet.getStake());
        log.info("내기 자동 취소 — 참가자 이탈로 개설자 단독. betId={}, creatorId={}",
                bet.getId(), bet.getCreatorUser().getId());
    }

    // ── 24h 동결 자동 환불 (정책 §E1, GROMO-1258) ────────────────────────

    /**
     * 정산이 하루 넘게 성공하지 못한 회차를 <b>무효화하고 전원 환불</b>한다 — 한 건 처분.
     * 대상 선정과 반복은 {@link GroupBetFreezeMonitor} 가 하고, 여기서는 건별 트랜잭션으로
     * 격리해 처분만 한다({@link GroupBetSettler#settle} 과 같은 격리 규율 — 한 건이 터져도
     * 나머지가 계속된다). 정산이 만들 수 없는 유일한 상태 {@link GroupBetStatus#REFUNDED} 로 닫는다.
     *
     * <p><b>"정산은 되돌리지 않는다"(§B8)와 충돌하지 않는다</b> — 정산된 건을 되돌리는 게 아니라
     * <b>정산 자체가 불가능한 건</b>(참가자 유실 · 챌린지 목표 유실 · 분배 불변식 위반)을 닫는
     * 것이다. 이 셋은 매일 같은 지점에서 실패하므로 재시도만으로는 영원히 풀리지 않고, 종전에는
     * 사람이 재배포로 개입하지 않는 한 참가비가 무기한 동결됐다(prod 수동 트리거조차 없었다).
     * "참가비는 어떤 경우에도 영원히 묶이지 않는다"를 사람이 아니라 시스템이 보장하게 하는 장치다.
     *
     * <p>잠금 규율은 다른 돈 경로와 같다: 내기 행(FOR UPDATE) → 지갑(userId 오름차순). 상태 전이는
     * 정산·취소와 같은 CAS 게이트라 정산 배치와 동시에 돌아도 한쪽만 돈을 움직이고, 재실행은
     * status(OPEN 아님)에서 1차로, 환불 멱등키({@link #refundKey})에서 2차로 걸러진다.
     *
     * @return 이번 호출이 실제로 회차를 닫고 환불했으면 true. 이미 종료됐거나 CAS 에서 밀렸으면 false
     */
    @Transactional
    public boolean refundFrozenBet(UUID betId) {
        Optional<GroupChallengeBet> locked = groupChallengeBetRepository.findByIdForUpdate(betId)
                .filter(GroupChallengeBet::isOpen);
        if (locked.isEmpty()) {
            return false;
        }
        GroupChallengeBet bet = locked.get();
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findByBetIdIn(List.of(betId));
        int claimed = groupChallengeBetRepository.compareAndSetSettled(
                betId, GroupBetStatus.REFUNDED, Instant.now());
        if (claimed == 0) {
            log.info("내기 24h 동결 환불 스킵 — 다른 트랜잭션이 먼저 종료시켰다. betId={}", betId);
            return false;
        }
        // 참가 행은 그대로 둔다 — 명단·인원수는 그날의 사실이고, 판정 결과(achieved/payout)가
        // 비어 있는 것이 "판정하지 못한 채 닫혔다"의 표현이다(취소 경로와 같은 관례).
        participants.stream()
                .sorted(Comparator.comparing(p -> p.getUser().getId()))
                .forEach(p -> refundParticipant(bet, p));
        log.warn("내기 24h 동결 자동 환불 — 정산 불가로 회차를 무효화한다. "
                        + "betId={}, betDate={}, stake={}, 환불 {}명",
                betId, bet.getBetDate(), bet.getStake(), participants.size());
        return true;
    }

    /**
     * CANCELED 전이 — 정산과 같은 CAS 게이트. 호출 전에 행 잠금 + OPEN 재확인을 거쳤으므로
     * 실패는 게이트 계약이 깨졌다는 뜻이다(예외로 전체 롤백).
     */
    private void claimCanceled(GroupChallengeBet bet) {
        int claimed = groupChallengeBetRepository.compareAndSetSettled(
                bet.getId(), GroupBetStatus.CANCELED, Instant.now());
        if (claimed == 0) {
            // 이 롤백은 그룹 탈퇴 트랜잭션 전체를 되돌린다(탈퇴만 되고 판돈이 묶이는 반쪽 상태 방지).
            // 잠금 규율이 지켜지는 한 도달 불가한 분기라, 도달했다면 잠금 코드가 깨진 것이다.
            log.error("CANCELED 전이 실패 — 행 잠금 규율 위반 의심. betId={}, status 재확인 필요", bet.getId());
            throw new IllegalStateException("행 잠금 아래에서 CANCELED 전이 실패 — betId=" + bet.getId());
        }
    }

    /**
     * 판돈 환불의 <b>단일 지점</b>(GROMO-1258) — 취소·철회·탈퇴 연동·24h 자동 환불이 전부 여기로
     * 모인다. 멱등키의 축이 차감과 같은 참가 행 id({@link #refundKey})라 "걷힌 회차 : 돌려준 회차"가
     * 1:1 로 대응하고, 경로가 겹쳐도 원장 유니크가 두 번째 기입을 거절한다.
     */
    private void refundParticipant(GroupChallengeBet bet, GroupChallengeBetParticipant participant) {
        applyRefund(bet, participant.getUser(), refundKey(bet.getId(), participant.getId()));
    }

    /**
     * 환불 실행부 — 앱 탈퇴자(지갑 삭제)는 지급 대상에서 뺀다({@link GroupBetSettler} 의 지급
     * 스킵과 같은 이유다).
     *
     * <p>멱등키 선점(applied=false)은 어느 호출자에게도 정상 흐름이 아니다 — 취소·탈퇴 경로는 CAS 로
     * 전이를 유일하게 가져간 뒤에만 여기 오고, 철회 경로의 키는 참가 회차별로 유일하다. 즉 <b>이
     * warn 이 뜨면 그것은 이례가 아니라 버그 신호</b>이므로 흔적을 남긴다.
     */
    private void applyRefund(GroupChallengeBet bet, User user, String idempotencyKey) {
        if (user.isDeleted()) {
            log.warn("내기 환불 스킵 — 탈퇴한 유저라 지갑이 없다. betId={}, userId={}, stake={}",
                    bet.getId(), user.getId(), bet.getStake());
            return;
        }
        boolean applied = currencyLedgerService.credit(user, CurrencyTransactionType.BET_REFUND,
                bet.getStake(), idempotencyKey);
        if (!applied) {
            log.warn("내기 환불 스킵 — 멱등키 선점됨(버그 신호). betId={}, userId={}, key={}",
                    bet.getId(), user.getId(), idempotencyKey);
        }
    }

    /**
     * 참가 행 생성 + 참가비 차감(에스크로). 개설자 자동 참가와 일반 참가가 같은 경로를 탄다.
     *
     * <p>멱등키의 축은 유저가 아니라 <b>참가 행 id</b> 다(계약 §2-2, GROMO-1112). 참가 행은 참가마다
     * 새로 만들어지는 UUID v7 이라 "참가 → 철회 → 재참여" 회차가 키 수준에서 갈린다. userId 를 축으로
     * 쓰던 시절에는 재참여가 같은 키를 만들어 차감이 조용히 스킵됐고, 참가 행만 생겨 <b>참가비 0원
     * 참가</b>가 성립했다 — 정산 팟은 참가비 × 참가자 수라 걷지 않은 코인이 승자에게 나갔다.
     *
     * <p>id 는 {@code save()} 반환값에서 읽는다. {@code @GeneratedUuidV7} 는
     * {@code BeforeExecutionGenerator} 라 persist 시점에 값이 잡히므로 flush 를 강제할 필요는 없다
     * ({@code saveAndFlush} 불필요 — {@code GroupBetLeaveIntegrationTest} 의 재참여 락 테스트가
     * 실 DB 로 고정한다).
     */
    private void stakeIn(GroupChallengeBet bet, User user) {
        GroupChallengeBetParticipant participant = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder()
                        .bet(bet)
                        .user(user)
                        .build());
        boolean applied = currencyLedgerService.debit(user, CurrencyTransactionType.BET_STAKE,
                bet.getStake(), stakeKey(bet.getId(), participant.getId()));
        if (!applied) {
            // 키에 참가 행 id 가 들어간 뒤로 선점은 정상 흐름에 존재하지 않는다. 그런데도 선점됐다면
            // id 생성이나 키 규약이 깨진 것이다 — 조용히 넘기면 차감 없는 참가 행이 남아 무임승차가
            // 되므로 트랜잭션 전체를 되돌린다.
            log.error("참가비 차감 스킵 — 멱등키 선점됨(도달 불가). betId={}, userId={}, participantId={}",
                    bet.getId(), user.getId(), participant.getId());
            throw new IllegalStateException("참가비 차감 멱등키 선점 — betId=" + bet.getId()
                    + ", participantId=" + participant.getId());
        }
    }

    // ── 조회 조립 (GroupChallengeService 가 챌린지 카드에 얹는다) ─────────────

    /**
     * 챌린지별 "오늘의 내기"를 배치 로드한다. {@code date} 가 없으면(하위 호환 조회) 빈 맵이다.
     *
     * <p><b>내일 폴백</b>(계약 §3 응답 보수, GROMO-1103): 조회일이 서버 KST 오늘이면, 오늘 내기가
     * 없는 챌린지에 한해 내일 OPEN 내기를 실어 준다 — 마감 후 "내일 시간대부터 적용"으로 연 내기가
     * 생성 직후 카드에서 안 보이는 구멍을 막는다. 응답의 {@code date}(bet_date)가 어느 날짜의
     * 내기인지 말한다. 과거 날짜 조회는 그날의 사실만 실어야 하므로 폴백하지 않는다.
     *
     * @param myAchievedByChallengeId 챌린지별 "나는 이미 달성했는가" — 호출측이 이미 계산해 둔
     *                                진행률 스냅샷을 재사용해 통계를 두 번 읽지 않는다
     * @return challengeId → 내기 (내기가 없는 챌린지는 키 없음)
     */
    public Map<UUID, GroupBetResponse> loadCurrentBets(
            Collection<UUID> challengeIds,
            LocalDate date,
            UUID userId,
            Map<UUID, Boolean> myAchievedByChallengeId) {
        if (date == null || challengeIds.isEmpty()) {
            return Map.of();
        }
        // 취소는 "없던 일"이라 CANCELED 만 뺀다 — 오늘·과거의 정산 결과(SETTLED·FORFEITED·REFUNDED)는
        // 그날의 사실이라 계속 실어야 한다. 앱 결과 모달이 어제 날짜 조회의 내기 존재 여부(hadBet)로
        // 판정하므로 OPEN 으로 좁히면 어제의 정산 내기가 사라져 결과 모달이 침묵한다(GROMO-1201).
        List<GroupChallengeBet> bets = new ArrayList<>(
                groupChallengeBetRepository.findByChallengeIdInAndBetDateAndStatusNot(
                        challengeIds, date, GroupBetStatus.CANCELED));
        if (date.equals(today())) {
            Set<UUID> covered = bets.stream()
                    .map(bet -> bet.getChallenge().getId())
                    .collect(Collectors.toSet());
            List<UUID> uncovered = challengeIds.stream()
                    .filter(challengeId -> !covered.contains(challengeId))
                    .toList();
            if (!uncovered.isEmpty()) {
                // 내일 폴백은 OPEN 만 싣는다 — 아직 시작도 안 한 판이라 정산 결과가 있을 수 없고,
                // 취소된 내일 내기는 "없던 일"이라 카드에 세울 자격이 없다.
                bets.addAll(groupChallengeBetRepository.findByChallengeIdInAndBetDateAndStatus(
                        uncovered, date.plusDays(1), GroupBetStatus.OPEN));
            }
        }
        if (bets.isEmpty()) {
            return Map.of();
        }

        Map<UUID, List<GroupChallengeBetParticipant>> participantsByBet = participantsByBet(bets);
        Map<UUID, GroupBetResponse> result = new LinkedHashMap<>();
        for (GroupChallengeBet bet : bets) {
            List<GroupChallengeBetParticipant> participants =
                    participantsByBet.getOrDefault(bet.getId(), List.of());
            UUID challengeId = bet.getChallenge().getId();
            result.put(challengeId, GroupBetResponse.builder()
                    .betId(bet.getId())
                    .creatorUserId(bet.getCreatorUser().getId())
                    .date(bet.getBetDate())
                    .stake(bet.getStake())
                    .pot(bet.getStake() * participants.size())
                    .status(bet.getStatus())
                    .myJoined(participants.stream()
                            .anyMatch(p -> p.getUser().getId().equals(userId)))
                    // 호출측 스냅샷은 조회일(오늘) 진행률이다 — 내일 폴백 내기의 판정일은 내일이라
                    // 아직 아무도 달성하지 않았다. 오늘 값을 그대로 실으면 앱이 내일 내기의 참가
                    // 버튼을 오늘 달성 사실로 잘못 잠근다(서버 joinBet 은 bet_date 기준이라 허용).
                    .myAchievedNow(bet.getBetDate().equals(date)
                            && myAchievedByChallengeId.getOrDefault(challengeId, false))
                    // 탈퇴자 닉네임 치환(GROMO-1220) — 신규 탈퇴자는 releaseFromAllOpenBets 가 OPEN
                    // 내기에서 해제하지만, 그 정리가 없던 시절(#497 이전)의 유령 참가 행 방어다.
                    .participants(participants.stream()
                            .map(p -> GroupBetParticipantResponse.builder()
                                    .userId(p.getUser().getId())
                                    .nickname(displayNickname(p.getUser()))
                                    .build())
                            .toList())
                    .build());
        }
        return result;
    }

    /**
     * 챌린지별 "가장 최근 정산 내기"를 배치 로드한다 — 카드의 지난 내기 한 줄용.
     * 조회 {@code date} 와 무관하므로 하위 호환 조회(date 없음)에서도 채워진다.
     *
     * @return challengeId → 최근 정산 내기 (정산 이력이 없는 챌린지는 키 없음)
     */
    public Map<UUID, GroupBetResultResponse> loadLastSettledBets(Collection<UUID> challengeIds) {
        if (challengeIds.isEmpty()) {
            return Map.of();
        }
        // 쿼리(DISTINCT ON)가 이미 챌린지당 1행으로 줄여 온다 — 애플리케이션에서 추리지 않는다.
        List<GroupChallengeBet> latest =
                groupChallengeBetRepository.findLatestSettledByChallengeIds(challengeIds);
        if (latest.isEmpty()) {
            return Map.of();
        }

        Map<UUID, List<GroupChallengeBetParticipant>> participantsByBet = participantsByBet(latest);
        Map<UUID, GroupBetResultResponse> result = new LinkedHashMap<>();
        latest.forEach(bet -> {
            List<GroupChallengeBetParticipant> participants =
                    participantsByBet.getOrDefault(bet.getId(), List.of());
            result.put(bet.getChallenge().getId(), GroupBetResultResponse.builder()
                    .betDate(bet.getBetDate())
                    .stake(bet.getStake())
                    .pot(bet.getStake() * participants.size())
                    .status(bet.getStatus())
                    .goalMinutes(bet.getGoalMinutes())
                    .results(toResultParticipants(participants))
                    .build());
        });
        return result;
    }

    /**
     * 내기 히스토리(GROMO-1207) — 챌린지의 정산 완료 내기(SETTLED·REFUNDED·FORFEITED)를
     * {@code bet_date} 내림차순 keyset 커서로 페이지네이션한다. 봉투는
     * {@code FocusSessionSliceResponse} 선례(content/size/hasNext/nextCursor)와 같다.
     *
     * <p>권한은 다른 내기 경로와 동일하다 — 게스트 {@code GUEST_FORBIDDEN}, 비그룹원
     * {@code MEMBER_ONLY}. 이력은 그룹원 전체가 열람한다(오너 결정, 계약 §2-1207).
     *
     * <p>커서는 직전 페이지 마지막 항목의 {@code betId} 다 — 서버가 그 내기의 {@code bet_date} 로
     * 해석해 strict {@code <} keyset 을 만든다. V28 부분 유니크가 비취소 내기를 챌린지·날짜당
     * 1개로 보장하므로 날짜 단독 축에 동률이 없다.
     */
    public GroupBetHistorySliceResponse getBetHistory(
            UUID groupId, UUID challengeId, UUID userId, UUID cursor, int size) {
        if (size < 1 || size > MAX_HISTORY_PAGE_SIZE) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        User user = requireActiveUserNoLock(userId);
        Group group = requireGroupMembership(user, groupId);
        // 삭제된 챌린지의 히스토리는 진입점(챌린지 카드)이 없다 — 조회 경로 공통 규칙대로 404.
        groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        Slice<GroupChallengeBet> slice;
        if (cursor == null) {
            slice = groupChallengeBetRepository.findSettledHistoryFirstPage(
                    challengeId, HISTORY_STATUSES, PageRequest.of(0, size));
        } else {
            // 커서는 챌린지 스코프로 해석 — 남의 챌린지 내기 id 로 임의 날짜 필터를 만들 수 없다.
            LocalDate cursorDate = groupChallengeBetRepository
                    .findBetDateByIdAndChallengeId(cursor, challengeId)
                    .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
            slice = groupChallengeBetRepository.findSettledHistoryAfterCursor(
                    challengeId, HISTORY_STATUSES, cursorDate, PageRequest.of(0, size));
        }
        List<GroupChallengeBet> pageBets = slice.getContent();
        // 참가자는 페이지 전체를 IN 1회로 배치 로드한다(N+1 금지) — 조회 조립 공용 헬퍼.
        Map<UUID, List<GroupChallengeBetParticipant>> participantsByBet =
                pageBets.isEmpty() ? Map.of() : participantsByBet(pageBets);

        List<GroupBetHistoryItemResponse> content = pageBets.stream()
                .map(bet -> {
                    List<GroupChallengeBetParticipant> participants =
                            participantsByBet.getOrDefault(bet.getId(), List.of());
                    return GroupBetHistoryItemResponse.builder()
                            .betId(bet.getId())
                            .betDate(bet.getBetDate())
                            .stake(bet.getStake())
                            .pot(bet.getStake() * participants.size())
                            .status(bet.getStatus())
                            .settledAt(bet.getSettledAt())
                            .goalMinutes(bet.getGoalMinutes())
                            .results(toResultParticipants(participants))
                            .build();
                })
                .toList();
        UUID nextCursor = slice.hasNext() && !pageBets.isEmpty()
                ? pageBets.get(pageBets.size() - 1).getId()
                : null;
        return new GroupBetHistorySliceResponse(content, size, slice.hasNext(), nextCursor);
    }

    /**
     * 정산 결과 참가자 한 줄 변환 — 최근 정산({@code loadLastSettledBets})과 히스토리 공용.
     * 탈퇴자는 닉네임만 {@link #WITHDRAWN_USER_NICKNAME} 로 치환한다(GROMO-1220, D1) —
     * 명단·인원수·pot 은 정산 당시 사실이라 절대 불변이다(계약 §1).
     */
    private List<GroupBetResultParticipantResponse> toResultParticipants(
            List<GroupChallengeBetParticipant> participants) {
        return participants.stream()
                .map(p -> GroupBetResultParticipantResponse.builder()
                        .userId(p.getUser().getId())
                        .nickname(displayNickname(p.getUser()))
                        .achieved(p.getAchieved())
                        .payout(p.getPayout())
                        .progressMinutes(p.getProgressMinutes())
                        .build())
                .toList();
    }

    /**
     * 명단 표시용 닉네임 — 탈퇴자(is_deleted, PII 파기로 nickname=null)는 고정 문구로 치환한다.
     * 탈퇴자 처리를 <b>출력(명단) 층에서만</b> 하는 계약(§1)의 단일 지점이다 — 조회 리포지토리
     * ({@code findByBetIdIn})나 정산·해제 경로에 필터를 넣으면 팟 계산·환불이 틀어진다.
     */
    private static String displayNickname(User user) {
        return user.isDeleted() ? WITHDRAWN_USER_NICKNAME : user.getNickname();
    }

    private Map<UUID, List<GroupChallengeBetParticipant>> participantsByBet(
            Collection<GroupChallengeBet> bets) {
        List<UUID> betIds = bets.stream().map(GroupChallengeBet::getId).toList();
        return groupChallengeBetParticipantRepository.findByBetIdIn(betIds).stream()
                .collect(Collectors.groupingBy(p -> p.getBet().getId()));
    }

    // ── 공용 가드 ────────────────────────────────────────────────────────

    /**
     * 멱등키 컨벤션 — 참가비 차감. 축은 유저가 아니라 <b>참가 행</b>이다(계약 §2-2) — 이유는
     * {@link #stakeIn}. 정산 키는 {@link GroupBetSettler} 가 만든다.
     */
    static String stakeKey(UUID betId, UUID participantId) {
        return "bet:" + betId + ":stake:" + participantId;
    }

    /**
     * 멱등키 컨벤션 — 판돈 환불. 차감({@link #stakeKey})과 <b>같은 축</b>(참가 행 id)이라 "참가 →
     * 철회 → 재참여" 회차가 키 수준에서 갈리고, 회차마다 정확히 한 번 걷혀 한 번 돌아간다.
     *
     * <p>취소·철회·탈퇴 연동·24h 자동 환불이 <b>전부 이 키 하나</b>를 쓰는 것이 핵심이다
     * (GROMO-1258). 종전에는 철회만 {@code :leave-refund:{participantId}} 로 축이 갈려 있어
     * 원장 유니크가 교차 경로를 막지 못했고, 철회 × 그룹 탈퇴가 겹치면 같은 참가 행의 판돈이
     * 두 번 환불됐다(정책 §C9). 정산 지급 키는 유저 축 그대로다({@link GroupBetSettler#payoutKey}).
     */
    static String refundKey(UUID betId, UUID participantId) {
        return "bet:" + betId + ":refund:" + participantId;
    }

    static LocalDate today() {
        return LocalDate.ofInstant(Instant.now(), KST);
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801, codex 리뷰 2차) — 락 없는 findById 면 계정 탈퇴(유저 행 배타
     * 락)와 직렬화되지 않아, 탈퇴의 참가자 스냅샷({@link #releaseFromAllOpenBets}) 이후에 커밋된
     * 참가가 정리에서 빠진다 — 탈퇴자 참가 행·지갑 없음·정산 스킵으로 팟이 오염되는, 그 정리가
     * 막으려던 바로 그 상태다. 참가 생성(createBet·joinBet)이 필수 대상이지만 헬퍼 전체에 건다:
     * ① 유저 락이 모든 경로의 <b>첫</b> 잠금이라(user → 내기 행 → 지갑) 기존 잠금 순서 규율과
     * 역전이 없고 ② 취소·철회는 내기 행 잠금으로 이미 탈퇴 정리와 직렬화되지만 공유 락끼리는
     * 병렬이라 추가 비용이 미미하며 ③ 탈퇴 유저의 잔여 토큰 접근을 네 경로 모두 표준 NOT_FOUND
     * 로 거절하게 된다(종전 findById 는 is_deleted 를 보지 않았다). 탈퇴가 먼저 커밋되면 빈 결과.
     */
    private User requireActiveUser(UUID userId) {
        User user = userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }

    /**
     * 활성·게스트 검증의 <b>락 없는</b> 판 (GROMO-1230) — 순수 읽기(readOnly) 조회 경로 전용.
     * {@link #requireActiveUser}(공유 락)를 쓰지 않는 이유: 이 클래스 기본 트랜잭션이 readOnly 라
     * Postgres 가 FOR SHARE 를 거절하고(read-only 에서 행 잠금 불가 — #510 CI 실측), 애초에 잠글
     * 이유도 없다 — 공유 락은 읽은 값이 변경(참가 생성·해제)의 근거가 될 때 탈퇴와 직렬화하려는
     * 장치인데, 순수 조회는 아무것도 변경하지 않아 stale 하게 읽혀도 결과가 응답 한 번에 그친다.
     *
     * <p>⚠ readOnly 전용이다 — users 행을 읽고 그 근거로 무언가를 <b>변경하는</b> 트랜잭션에서
     * 이 헬퍼를 쓰면 탈퇴와 직렬화되지 않아 락 규율(GROMO-801) 위반이다. 변경 트랜잭션은
     * {@link #requireActiveUser}(공유 락) 또는 배타 락(UserRepository 락 선택 원칙)을 쓸 것.
     */
    private User requireActiveUserNoLock(UUID userId) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }

    private Group requireGroupMembership(User user, UUID groupId) {
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        return group;
    }

    /**
     * 창형(TIME_WINDOW) 마감 — 오늘 창이 이미 끝났으면 개설·참가를 막는다. 창이 끝난 뒤에 걸면 결과가
     * 이미 정해진 판에 올라타는 것이라 DURATION 의 "당일 자정 전"과 같은 성격의 가드다. DURATION 은
     * 창이 없어 날짜 검사만으로 충분하다(마감 코드도 {@code BET_CLOSED} 로 같다).
     *
     * <p><b>자정 걸침 창에서는 이 가드가 도달하지 않는다</b>(PR #446 리뷰). 예로 22:00~01:00 창의
     * 날짜 D 창은 {@code D+1 01:00} 에 끝나는데, 이 가드는 {@code date} 가 오늘 이후일 때만 실행되므로
     * (개설은 오늘 내기에만 검사하고 내일 내기는 건너뛴다 — GROMO-1103, 참가는 {@code bet_date} 가
     * 오늘 이상) "오늘"인 동안 {@code now} 는 항상 그 종료 시각보다 이르다. 실질 마감은
     * 자정에 {@code today()} 가 넘어가면서 앞의 날짜 게이트가 대신 처리한다 — 즉 자정 걸침 창은
     * 마지막 1시간(00:00~01:00) 동안 새 개설·참가를 받지 않는다.
     *
     * <p>일부러 그대로 둔다. ① 더 일찍 닫는 쪽이라 "결과가 정해진 판에 올라타기"는 여전히 불가능하고
     * (자금 안전 방향), ② 마지막 1시간을 열려면 {@code betDate} 가 어제인 내기를 허용해야 하는데
     * 이는 "betDate = KST 오늘"이라는 계약 공통 규칙과 01:00 정산 배치의 대상 선정 전제를 동시에
     * 흔든다. 같은 시각 판정(집계)은 창 전체를 그대로 쓰므로 이미 참가한 사람의 판정에는 영향이 없다.
     * 실제 경계값은 {@code GroupBetJudgeIntegrationTest} 가 실 DB 로 고정한다.
     */
    private void requireWindowStillOpen(GroupBetJudge.Target target, LocalDate date) {
        Optional<Instant> closesAt = groupBetJudge.windowClosesAt(target, date);
        if (closesAt.isPresent() && !Instant.now().isBefore(closesAt.get())) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }
    }

    /**
     * 판돈을 걸 자격 — 카테고리마다 막는 방향이 반대다.
     *
     * <ul>
     *   <li><b>FOCUS</b>: 이미 달성했으면 거절({@code BET_ALREADY_ACHIEVED}). 서버 데이터라 달성이
     *       확정 의미이고, 확정된 뒤 올라타는 무위험 참가를 막는다(창형은 5분 관용치 포함 — 카드
     *       진행률·정산과 같은 판정 소스다)</li>
     *   <li><b>SCREEN_TIME</b>: 달성은 하루/창이 끝나야 확정되므로 "이미 달성"이 무위험이 아니다
     *       (이후 사용으로 뒤집힌다). 대신 <b>이미 목표를 초과해 패배가 확정된</b> 유저를 거절한다
     *       ({@code BET_ALREADY_FAILED}) — 질 게 정해진 판돈 투입 방지</li>
     * </ul>
     *
     * <p>비용은 조합별 소스 조회 1회다(카드 진행률과 같은 쿼리).
     */
    private void requireEligibleToStake(GroupBetJudge.Target target, User user, LocalDate date) {
        Integer minutes = groupBetJudge.progressMinutes(target, date, List.of(user)).get(user.getId());
        if (target.category() == MissionCategory.SCREEN_TIME) {
            // 미보고(null)는 잠정 달성으로 보고 통과시킨다 — 초과가 확인된 경우에만 막는다.
            if (minutes != null && minutes > target.goalMinutes()) {
                throw new GroupException(GroupErrorCode.BET_ALREADY_FAILED);
            }
            return;
        }
        if (GroupBetJudge.isAchieved(target, minutes)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_ACHIEVED);
        }
    }
}

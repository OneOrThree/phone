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
 * 트랜잭션)가 맡는다 — 여기서는 유저 요청 경로만 다룬다.
 *
 * <p>판돈 차감은 {@link CurrencyLedgerService#debit} 로 하며 멱등키
 * {@code bet:{betId}:stake:{userId}} 를 함께 남긴다. 잔액은 {@code UserWallet} 의 @Version
 * 낙관락이, 중복 참가·중복 개설은 DB 유니크 제약이 각각 최후 방어선이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupBetService {

    /** 서버가 허용하는 판돈. 자유 입력은 검증·UX 비용만 늘려 얇게 고정한다. */
    static final Set<Integer> ALLOWED_STAKES = Set.of(10, 30, 50, 100);

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

        if (!ALLOWED_STAKES.contains(request.getStake())) {
            throw new GroupException(GroupErrorCode.BET_INVALID_STAKE);
        }
        // 내기는 "오늘 하루"만 걸 수 있다 — 지난 날짜는 결과가 이미 정해졌고, 미래 날짜는 정산 배치
        // (전일자 대상)의 전제를 깬다.
        LocalDate betDate = request.getDate();
        if (!betDate.equals(today())) {
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
        requireWindowStillOpen(target, betDate);

        if (groupChallengeBetRepository.existsByChallengeIdAndBetDate(challengeId, betDate)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_EXISTS);
        }
        requireEligibleToStake(target, user, betDate);

        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(challenge)
                .creatorUser(user)
                .stake(request.getStake())
                .betDate(betDate)
                .status(GroupBetStatus.OPEN)
                .build());
        stakeIn(bet, user);

        log.info("내기 개설 — betId={}, challengeId={}, betDate={}, stake={}, creator={}",
                bet.getId(), challengeId, betDate, bet.getStake(), userId);
        return CreateBetResponse.builder().betId(bet.getId()).build();
    }

    /** 진행 중(OPEN·오늘) 내기에 참가한다. 판돈은 즉시 차감된다. */
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
        // 날짜도 함께 본다. 창형은 날짜가 같아도 오늘 창이 끝났으면 아래에서 추가로 막는다.
        if (!bet.isOpen() || !bet.getBetDate().equals(today())) {
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
     * 돌려주고, 이 취소는 {@code BET_NOT_OPEN} 으로 거절된다(환불 없음). 환불 멱등키가 정산 환불과
     * 같은 포맷({@code bet:{betId}:refund:{userId}})이라 이중 환불은 원장 유니크가 최후 방어한다.
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
        refundStake(bet, user);

        log.info("내기 취소 — betId={}, challengeId={}, userId={}, stake={} 환불",
                betId, bet.getChallenge().getId(), userId, bet.getStake());
    }

    /**
     * 그룹 탈퇴 연동 — 탈퇴자가 참가 중인 OPEN 내기에서 빼고 판돈을 환불한다.
     * {@link GroupMemberService#withdrawGroup} 가 탈퇴와 <b>같은 트랜잭션</b>에서 호출한다
     * (탈퇴만 되고 판돈이 묶이는 반쪽 상태 방지).
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
     */
    @Transactional
    public void releaseFromOpenBets(User user, Group group) {
        List<UUID> betIds = groupChallengeBetRepository
                .findOpenBetIdsByGroupIdAndParticipantUserId(group.getId(), user.getId());

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
            List<GroupChallengeBetParticipant> participants =
                    groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId()));
            if (bet.getCreatorUser().getId().equals(user.getId())) {
                cancelAndRefundAll(bet, participants);
            } else {
                detachAndRefund(bet, participants, user);
            }
        }
    }

    /**
     * 개설자 탈퇴 — 내기 전체를 취소하고 전원(개설자 포함) 환불한다.
     * 환불은 userId 오름차순 — 여러 지갑을 만지는 경로(정산 지급 포함)끼리 지갑 잠금 순서를
     * 맞춰 두기 위한 고정이다.
     */
    private void cancelAndRefundAll(GroupChallengeBet bet, List<GroupChallengeBetParticipant> participants) {
        claimCanceled(bet);
        participants.stream()
                .sorted(Comparator.comparing(p -> p.getUser().getId()))
                .forEach(p -> refundStake(bet, p.getUser()));
        log.info("내기 자동 취소 — 개설자 그룹 탈퇴. betId={}, creatorId={}, 환불 {}명",
                bet.getId(), bet.getCreatorUser().getId(), participants.size());
    }

    /** 일반 참가자 탈퇴 — 참가 행 삭제 + 본인 환불. 개설자 혼자 남으면 자동 취소까지. */
    private void detachAndRefund(
            GroupChallengeBet bet, List<GroupChallengeBetParticipant> participants, User leaver) {
        participants.stream()
                .filter(p -> p.getUser().getId().equals(leaver.getId()))
                .forEach(groupChallengeBetParticipantRepository::delete);

        List<GroupChallengeBetParticipant> remaining = participants.stream()
                .filter(p -> !p.getUser().getId().equals(leaver.getId()))
                .toList();
        boolean creatorAlone = remaining.size() == 1
                && remaining.get(0).getUser().getId().equals(bet.getCreatorUser().getId());
        if (!creatorAlone) {
            refundStake(bet, leaver);
            log.info("내기 참가 해제 — 그룹 탈퇴. betId={}, userId={}, stake={} 환불",
                    bet.getId(), leaver.getId(), bet.getStake());
            return;
        }

        // 자동 취소 — 탈퇴자·개설자 환불 2건도 userId 오름차순으로 고정한다. "탈퇴자 먼저" 고정이면
        // 탈퇴자 UUID 가 더 클 때 지갑 잠금이 내림차순이 되어, 오름차순으로 도는 다른 지갑-다중
        // 경로(전원 환불·정산 지급·반대 방향 탈퇴)와 교차 데드락이 성립한다 (PR #427 리뷰).
        claimCanceled(bet);
        Stream.of(leaver, remaining.get(0).getUser())
                .sorted(Comparator.comparing(User::getId))
                .forEach(u -> refundStake(bet, u));
        log.info("내기 참가 해제 — 그룹 탈퇴. betId={}, userId={}, stake={} 환불",
                bet.getId(), leaver.getId(), bet.getStake());
        log.info("내기 자동 취소 — 참가자 이탈로 개설자 단독. betId={}, creatorId={}",
                bet.getId(), bet.getCreatorUser().getId());
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
     * 판돈 환불 — 정산 환불과 같은 멱등키 포맷이라 같은 유저에게 어떤 경로로든 두 번 환불되지 않는다.
     * 앱 탈퇴자(지갑 삭제)는 지급 대상에서 뺀다 — {@link GroupBetSettler} 의 지급 스킵과 같은 이유다.
     */
    private void refundStake(GroupChallengeBet bet, User user) {
        if (user.isDeleted()) {
            log.warn("내기 환불 스킵 — 탈퇴한 유저라 지갑이 없다. betId={}, userId={}, stake={}",
                    bet.getId(), user.getId(), bet.getStake());
            return;
        }
        boolean applied = currencyLedgerService.credit(user, CurrencyTransactionType.BET_REFUND,
                bet.getStake(), GroupBetSettler.payoutKey(bet.getId(), user.getId(), true));
        if (!applied) {
            // CAS 로 전이를 유일하게 가져간 뒤의 호출이라 멱등키 선점은 정상 흐름에 없다 — 흔적을 남긴다.
            log.warn("내기 환불 스킵 — 멱등키 선점됨(이례). betId={}, userId={}", bet.getId(), user.getId());
        }
    }

    /** 참가 행 생성 + 판돈 차감(에스크로). 개설자 자동 참가와 일반 참가가 같은 경로를 탄다. */
    private void stakeIn(GroupChallengeBet bet, User user) {
        groupChallengeBetParticipantRepository.save(GroupChallengeBetParticipant.builder()
                .bet(bet)
                .user(user)
                .build());
        currencyLedgerService.debit(user, CurrencyTransactionType.BET_STAKE, bet.getStake(),
                stakeKey(bet.getId(), user.getId()));
    }

    // ── 조회 조립 (GroupChallengeService 가 챌린지 카드에 얹는다) ─────────────

    /**
     * 챌린지별 "오늘의 내기"를 배치 로드한다. {@code date} 가 없으면(하위 호환 조회) 빈 맵이다.
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
        List<GroupChallengeBet> bets =
                groupChallengeBetRepository.findByChallengeIdInAndBetDate(challengeIds, date);
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
                    .stake(bet.getStake())
                    .pot(bet.getStake() * participants.size())
                    .status(bet.getStatus())
                    .myJoined(participants.stream()
                            .anyMatch(p -> p.getUser().getId().equals(userId)))
                    .myAchievedNow(myAchievedByChallengeId.getOrDefault(challengeId, false))
                    .participants(participants.stream()
                            .map(p -> GroupBetParticipantResponse.builder()
                                    .userId(p.getUser().getId())
                                    .nickname(p.getUser().getNickname())
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
                    .results(participants.stream()
                            .map(p -> GroupBetResultParticipantResponse.builder()
                                    .userId(p.getUser().getId())
                                    .nickname(p.getUser().getNickname())
                                    .achieved(p.getAchieved())
                                    .payout(p.getPayout())
                                    .build())
                            .toList())
                    .build());
        });
        return result;
    }

    private Map<UUID, List<GroupChallengeBetParticipant>> participantsByBet(
            Collection<GroupChallengeBet> bets) {
        List<UUID> betIds = bets.stream().map(GroupChallengeBet::getId).toList();
        return groupChallengeBetParticipantRepository.findByBetIdIn(betIds).stream()
                .collect(Collectors.groupingBy(p -> p.getBet().getId()));
    }

    // ── 공용 가드 ────────────────────────────────────────────────────────

    /** 멱등키 컨벤션 — 판돈 차감. 정산 키는 {@link GroupBetSettler} 가 만든다. */
    static String stakeKey(UUID betId, UUID userId) {
        return "bet:" + betId + ":stake:" + userId;
    }

    static LocalDate today() {
        return LocalDate.ofInstant(Instant.now(), KST);
    }

    private User requireActiveUser(UUID userId) {
        User user = userRepository.findById(userId)
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
     * 날짜 D 창은 {@code D+1 01:00} 에 끝나는데, 이 가드는 호출자가 이미 {@code betDate == 오늘} 을
     * 확인한 뒤에만 실행되므로 "오늘"인 동안 {@code now} 는 항상 그 종료 시각보다 이르다. 실질 마감은
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

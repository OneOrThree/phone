package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
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
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
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
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

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
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final CurrencyLedgerService currencyLedgerService;

    // ── 개설 / 참가 ──────────────────────────────────────────────────────

    /**
     * 내기 개설. 그룹원 누구나 개설할 수 있고 개설자는 자동 참가(판돈 즉시 차감)한다.
     *
     * <p>FOCUS + DURATION 챌린지만 대상이다 — SCREEN_TIME 달성은 클라 업로드 신뢰라 돈을 걸 수 없고,
     * TIME_WINDOW 는 달성 판정 자체가 아직 없다.
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
        if (challenge.getCategory() != MissionCategory.FOCUS || challenge.getType() != MissionType.DURATION) {
            throw new GroupException(GroupErrorCode.BET_FOCUS_ONLY);
        }
        int goalMinutes = requireGoalMinutes(challengeId);

        if (groupChallengeBetRepository.existsByChallengeIdAndBetDate(challengeId, betDate)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_EXISTS);
        }
        requireNotAchievedYet(userId, betDate, goalMinutes);

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

        GroupChallengeBet bet = groupChallengeBetRepository.findByIdAndGroupId(betId, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        // 정산됐거나(status≠OPEN) 날짜가 지난 내기는 닫힌 것으로 본다. 배치가 돌기 전(04:00 KST 이전)의
        // 전일자 내기가 여기 걸린다 — status 만으로는 못 막는 구간이라 날짜도 함께 본다.
        if (!bet.isOpen() || !bet.getBetDate().equals(today())) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }
        if (groupChallengeBetParticipantRepository.existsByBetIdAndUserId(betId, userId)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_JOINED);
        }
        requireNotAchievedYet(userId, bet.getBetDate(), requireGoalMinutes(bet.getChallenge().getId()));

        stakeIn(bet, user);
        log.info("내기 참가 — betId={}, userId={}, stake={}", betId, userId, bet.getStake());
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

    private int requireGoalMinutes(UUID challengeId) {
        return groupChallengeDurationRepository.findById(challengeId)
                .map(GroupChallengeDuration::getDurationMinutes)
                // DURATION 챌린지인데 상세 행이 없으면 데이터 유실 — 목표를 모르니 정산도 불가하다.
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
    }

    /**
     * 이미 목표를 달성한 상태면 참가를 거절한다 — 결과가 확정된 뒤 무위험으로 올라타는 공짜 승리 차단.
     * 진행률 계산 인프라(daily_focus_stats)를 그대로 쓰므로 비용은 조회 1회다.
     */
    private void requireNotAchievedYet(UUID userId, LocalDate date, int goalMinutes) {
        if (focusMinutes(userId, date) >= goalMinutes) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_ACHIEVED);
        }
    }

    private int focusMinutes(UUID userId, LocalDate date) {
        return dailyFocusStatRepository.findByUserIdInAndDate(List.of(userId), date).stream()
                .mapToInt(DailyFocusStat::getTotalFocusSeconds)
                .max()
                .orElse(0) / 60;   // GROMO-642: 초→분
    }
}

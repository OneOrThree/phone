package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 내기 <b>한 건</b>을 정산한다 — 이 클래스의 트랜잭션 경계가 곧 "내기 단위 롤백"의 단위다.
 *
 * <p>배치 진입점({@link GroupBetSettlementService})과 클래스를 나눈 이유는 자기 호출(self-invocation)
 * 로는 프록시를 타지 않아 건별 트랜잭션이 성립하지 않기 때문이다. 한 건이 불변식 위반으로 터져도
 * 그 건만 롤백되고 나머지 정산은 계속된다.
 *
 * <p><b>달성 판정의 근거는 {@code daily_focus_stats}</b> 다 — 챌린지 카드가 보여주는 진행률과 같은
 * 소스·같은 날짜 버킷(세션 종료 시각의 유저 존 로컬 날짜, GROMO-803)을 쓴다. 정산이 화면과 다른
 * 기준으로 판정하면 "내 카드엔 달성인데 돈은 못 받았다"가 되므로 버킷을 일부러 맞춘 것이다. 여기서
 * 오는 두 가지 성질은 알려진 수용 사항이다: ① 자정을 걸친 세션은 종료일 버킷으로 가므로 그날 내기엔
 * 잡히지 않는다(카드 진행률도 동일), ② 이 통계는 클라가 올린 세션 시각을 그대로 누적하므로 위조
 * 여지가 남는데, 리그·스트릭·재화 적립이 모두 공유하는 플랫폼 차원의 신뢰 전제라 별도 티켓에서 다룬다.
 * 무위험 참가(이미 달성 후 참가)는 개설·참가 단계에서 {@code BET_ALREADY_ACHIEVED} 로 막는다.
 *
 * <p>정산은 배치 시각(04:00 KST)에 마감된다 — 그 뒤에 도착한 지난 날짜 기록은 반영되지 않는다.
 * 4시간의 그레이스가 그 창을 좁히는 장치이고, 마감 자체는 어떤 정산에도 필요한 성질이다.
 *
 * <p>재실행·동시 실행 방어는 3중이다: ① 내기 {@code status} 가 OPEN 이 아니면 즉시 스킵(순차 재실행),
 * ② 지급 직전 상태 전이를 원자적 CAS
 * ({@link GroupChallengeBetRepository#compareAndSetSettled})로 잠가 동시 실행 중 한 트랜잭션만
 * 통과시킨다, ③ 그래도 뚫리면 {@code currency_transactions.idempotency_key} 유니크가 최후 방어선이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSettler {

    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final CurrencyLedgerService currencyLedgerService;

    /**
     * 정산 결과.
     *
     * @param status  정산 후 내기 상태
     * @param applied 이번 호출이 실제로 지급을 적용했으면 true. 이미 종료됐거나 CAS 에서 밀려
     *                아무 것도 하지 않았으면 false — 호출자(배치 요약)가 남이 한 정산을 제 성과로
     *                세지 않도록 "최종 상태"와 "내가 한 일"을 분리한다
     */
    public record SettleResult(GroupBetStatus status, boolean applied) {
    }

    /**
     * @param betId 정산할 내기
     * @return 정산 후 상태 + 이번 호출이 실제로 지급했는지. 이미 정산돼 있었으면 그 상태를
     *         {@code applied=false} 로 돌려준다(스킵)
     * @throws IllegalStateException 참가자 유실·분배 불변식 위반 — 이 내기만 롤백된다
     */
    @Transactional
    public SettleResult settle(UUID betId) {
        GroupChallengeBet bet = groupChallengeBetRepository.findById(betId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        if (!bet.isOpen()) {
            log.info("내기 정산 스킵 — 이미 종료됨. betId={}, status={}", betId, bet.getStatus());
            return new SettleResult(bet.getStatus(), false);
        }

        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findByBetIdIn(List.of(betId));
        if (participants.isEmpty()) {
            // 개설과 동시에 개설자가 참가하므로 정상 흐름에서는 있을 수 없다.
            throw new IllegalStateException("참가자 없는 내기 — betId=" + betId);
        }

        int goalMinutes = groupChallengeDurationRepository.findById(bet.getChallenge().getId())
                .map(GroupChallengeDuration::getDurationMinutes)
                .orElseThrow(() -> new IllegalStateException(
                        "DURATION 상세 유실 — 목표를 몰라 정산할 수 없다. betId=" + betId));

        Map<UUID, Integer> focusMinutes = focusMinutesOf(participants, bet);
        List<GroupBetPayoutCalculator.Entry> entries = participants.stream()
                .map(p -> {
                    UUID userId = p.getUser().getId();
                    int minutes = focusMinutes.getOrDefault(userId, 0);
                    return new GroupBetPayoutCalculator.Entry(userId, minutes, minutes >= goalMinutes);
                })
                .toList();

        GroupBetPayoutCalculator.Distribution distribution =
                GroupBetPayoutCalculator.distribute(bet.getStake(), entries);

        // 여기까지는 전부 읽기다 — 돈이 움직이기 직전에 상태 전이를 원자적으로 잠근다.
        // 스케줄러와 수동 트리거가 동시에 같은 내기를 집어도 CAS 에 성공한 쪽만 지급을 적용한다.
        int claimed = groupChallengeBetRepository.compareAndSetSettled(
                betId, distribution.status(), Instant.now());
        if (claimed == 0) {
            GroupBetStatus current = groupChallengeBetRepository.findStatusById(betId)
                    .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
            log.info("내기 정산 스킵 — 동시 실행에서 다른 트랜잭션이 먼저 정산함. betId={}, status={}",
                    betId, current);
            return new SettleResult(current, false);
        }

        apply(bet, participants, distribution);

        log.info("내기 정산 완료 — betId={}, betDate={}, status={}, pot={}, 참가자={}",
                betId, bet.getBetDate(), distribution.status(), distribution.pot(), participants.size());
        return new SettleResult(distribution.status(), true);
    }

    private void apply(
            GroupChallengeBet bet,
            List<GroupChallengeBetParticipant> participants,
            GroupBetPayoutCalculator.Distribution distribution) {
        Map<UUID, GroupChallengeBetParticipant> byUserId = new HashMap<>();
        participants.forEach(p -> byUserId.put(p.getUser().getId(), p));

        boolean refunded = distribution.status() == GroupBetStatus.REFUNDED;
        CurrencyTransactionType type = refunded
                ? CurrencyTransactionType.BET_REFUND
                : CurrencyTransactionType.BET_PAYOUT;

        for (GroupBetPayoutCalculator.Payout payout : distribution.payouts()) {
            GroupChallengeBetParticipant participant = byUserId.get(payout.userId());
            participant.recordSettlement(payout.achieved(), payout.amount());
            if (payout.amount() > 0) {
                currencyLedgerService.credit(participant.getUser(), type, payout.amount(),
                        payoutKey(bet.getId(), payout.userId(), refunded));
            }
        }
    }

    /** 내기 날짜의 참가자별 집중 분. 통계 행이 없으면 "0분 집중"이 사실이므로 키를 만들지 않는다. */
    private Map<UUID, Integer> focusMinutesOf(
            List<GroupChallengeBetParticipant> participants, GroupChallengeBet bet) {
        List<UUID> userIds = participants.stream().map(p -> p.getUser().getId()).toList();
        Map<UUID, Integer> minutes = new HashMap<>();
        for (DailyFocusStat stat : dailyFocusStatRepository.findByUserIdInAndDate(userIds, bet.getBetDate())) {
            minutes.merge(stat.getUser().getId(), stat.getTotalFocusSeconds() / 60, Integer::max);
        }
        return minutes;
    }

    /** 멱등키 컨벤션 — 지급/환불. 판돈 차감 키는 {@link GroupBetService#stakeKey}. */
    static String payoutKey(UUID betId, UUID userId, boolean refunded) {
        return "bet:" + betId + (refunded ? ":refund:" : ":payout:") + userId;
    }
}

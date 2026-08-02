package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.user.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Comparator;
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
 * <p><b>달성 판정은 {@link GroupBetJudge} 가 조합별로 한다</b> — 챌린지 카드가 보여주는 진행률과 같은
 * 소스·같은 날짜 버킷(세션 종료 시각의 유저 존 로컬 날짜, GROMO-803)을 쓴다. 정산이 화면과 다른
 * 기준으로 판정하면 "내 카드엔 달성인데 돈은 못 받았다"가 되므로 소스를 일부러 맞춘 것이다. 여기서
 * 오는 성질들은 알려진 수용 사항이다: ① 자정을 걸친 세션은 종료일 버킷으로 가므로 그날 내기엔
 * 잡히지 않는다(카드 진행률도 동일), ② FOCUS 통계는 클라가 올린 세션 시각을 그대로 누적하고
 * SCREEN_TIME 은 아예 클라 보고값이라 위조 여지가 남는데, 리그·스트릭·재화 적립이 공유하는 플랫폼
 * 차원의 신뢰 전제라 별도 티켓에서 다룬다(스크린타임 내기는 리스크 수용이 확정 정책), ③ SCREEN_TIME
 * 은 미보고를 <b>미달성</b>으로 확정한다 — 정산은 마감돼야 하기 때문이다.
 * 무위험 참가는 개설·참가 단계에서 {@code BET_ALREADY_ACHIEVED}(FOCUS) ·
 * {@code BET_ALREADY_FAILED}(SCREEN_TIME) 로 막는다.
 *
 * <p>정산은 배치 시각(FOCUS 01:00 · SCREEN_TIME 12:00 KST)에 마감된다 — 그 뒤에 도착한 지난 날짜
 * 기록은 반영되지 않는다. 마감 자체는 어떤 정산에도 필요한 성질이다.
 *
 * <p>재실행·동시 실행 방어는 4중이다: ① 첫 조회가 내기 행 잠금(FOR UPDATE)이라 같은 내기를 만지는
 * 경로(동시 정산·그룹 탈퇴 연동의 참가 행 삭제/환불)와 통째로 직렬화된다, ② 내기 {@code status} 가
 * OPEN 이 아니면 즉시 스킵(순차 재실행), ③ 지급 직전 상태 전이를 원자적 CAS
 * ({@link GroupChallengeBetRepository#compareAndSetSettled})로 잠가 동시 실행 중 한 트랜잭션만
 * 통과시킨다, ④ 그래도 뚫리면 {@code currency_transactions.idempotency_key} 유니크가 최후 방어선이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSettler {

    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final CurrencyLedgerService currencyLedgerService;
    private final GroupBetJudge groupBetJudge;

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
        // 잠금 조회 — 그룹 탈퇴 연동(참가 행 삭제 + 환불)과 내기 단위로 직렬화한다. 아래의 참가자
        // 읽기가 잠금 없이 이뤄지면, 탈퇴가 참가 행을 지우고 환불한 뒤에도 이쪽의 낡은 스냅샷이
        // 탈퇴자에게 지급까지 해 이중 지급이 된다. status CAS 는 상태 전이만 지킬 뿐 참가자 읽기는
        // 못 지키는 구멍이라 행 잠금으로 막는다.
        GroupChallengeBet bet = groupChallengeBetRepository.findByIdForUpdate(betId)
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

        // 상세(duration/window) 유실이면 목표를 몰라 정산할 수 없다 — 이 건만 롤백시킨다.
        GroupBetJudge.Target target = groupBetJudge.resolve(bet.getChallenge())
                .orElseThrow(() -> new IllegalStateException(
                        "챌린지 목표 유실 — 목표를 몰라 정산할 수 없다. betId=" + betId));

        List<User> users = participants.stream().map(GroupChallengeBetParticipant::getUser).toList();
        Map<UUID, Integer> progressMinutes = groupBetJudge.progressMinutes(target, bet.getBetDate(), users);
        List<GroupBetPayoutCalculator.Entry> entries = participants.stream()
                .map(p -> {
                    UUID userId = p.getUser().getId();
                    Integer minutes = progressMinutes.get(userId);
                    // 잔여 배분의 성과 비교값 — 값이 없으면 0. SCREEN_TIME 미보고는 어차피 미달성이라
                    // 승자 목록에 들지 않으므로 이 0 이 잔여 배분을 왜곡하지 않는다.
                    return new GroupBetPayoutCalculator.Entry(userId,
                            minutes == null ? 0 : minutes,
                            GroupBetJudge.isAchieved(target, minutes));
                })
                .toList();

        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(
                bet.getStake(), GroupBetJudge.remainderRule(target), entries);

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

        log.info("내기 정산 완료 — betId={}, betDate={}, category={}, type={}, status={}, pot={}, 참가자={}",
                betId, bet.getBetDate(), target.category(), bet.getChallenge().getType(),
                distribution.status(), distribution.pot(), participants.size());
        return new SettleResult(distribution.status(), true);
    }

    private void apply(
            GroupChallengeBet bet,
            List<GroupChallengeBetParticipant> participants,
            GroupBetPayoutCalculator.Distribution distribution) {
        Map<UUID, GroupChallengeBetParticipant> byUserId = new HashMap<>();
        participants.forEach(p -> byUserId.put(p.getUser().getId(), p));

        if (distribution.status() == GroupBetStatus.FORFEITED) {
            // 승자 0명 — 판정 결과만 기록하고 지급 루프는 아예 타지 않는다(전원 payout 0).
            // 팟은 아무에게도 가지 않고 소멸하므로 원장에는 어떤 기입도 남지 않는다 — 차감(BET_STAKE)
            // 기록만 남는 것이 몰수의 원장 표현이다. 로그 포맷은 ops 모니터링(B4)과 정렬된 고정 문구다.
            distribution.payouts().forEach(payout ->
                    byUserId.get(payout.userId()).recordSettlement(payout.achieved(), payout.amount()));
            log.info("내기 몰수 — betId={}, pot={} 소멸", bet.getId(), distribution.pot());
            return;
        }

        // 지급은 userId 오름차순 — 여러 지갑을 만지는 경로(탈퇴 연동의 전원 환불 포함)끼리
        // 지갑 잠금 순서를 맞춰 두기 위한 고정이다.
        List<GroupBetPayoutCalculator.Payout> ordered = distribution.payouts().stream()
                .sorted(Comparator.comparing(GroupBetPayoutCalculator.Payout::userId))
                .toList();
        for (GroupBetPayoutCalculator.Payout payout : ordered) {
            GroupChallengeBetParticipant participant = byUserId.get(payout.userId());
            participant.recordSettlement(payout.achieved(), payout.amount());
            if (payout.amount() <= 0) {
                continue;
            }
            User user = participant.getUser();
            if (user.isDeleted()) {
                // 탈퇴자는 지갑이 이미 삭제돼 있다(UserService.withdraw 가 user 행은 남기고
                // user_wallets 만 지운다 — 참가 행은 FK 때문에 그대로 남는다). 그대로 credit 하면
                // 지갑 조회가 NOT_FOUND 로 터지고 트랜잭션 전체가 롤백돼, 앞서 처리한 다른 참가자의
                // 지급까지 되돌아가고 내기가 OPEN 에 갇힌다 — 다음 날 배치도 같은 지점에서 실패하므로
                // 나머지 참가자의 판돈이 영구히 묶인다(PR #381 리뷰). 지급 대상에서만 빼고 정산은
                // 끝낸다. 탈퇴 시점에 잔액 전체가 이미 소멸했으므로 돌려줄 지갑 자체가 없다.
                // 참가 행에는 계산된 몫을 그대로 남긴다 — 분배 계산의 근거(합 = 팟)는 보존하고,
                // 실제 이동 여부는 원장(currency_transactions)이 단일 진실이다.
                log.warn("내기 지급 스킵 — 탈퇴한 참가자라 지갑이 없다. betId={}, userId={}, amount={}",
                        bet.getId(), payout.userId(), payout.amount());
                continue;
            }
            currencyLedgerService.credit(user, CurrencyTransactionType.BET_PAYOUT, payout.amount(),
                    payoutKey(bet.getId(), payout.userId(), false));
        }
    }

    /** 멱등키 컨벤션 — 지급/환불. 판돈 차감 키는 {@link GroupBetService#stakeKey}. */
    static String payoutKey(UUID betId, UUID userId, boolean refunded) {
        return "bet:" + betId + (refunded ? ":refund:" : ":payout:") + userId;
    }
}

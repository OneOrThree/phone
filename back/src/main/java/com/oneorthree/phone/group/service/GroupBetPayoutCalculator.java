package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * 내기 분배 엔진 — 순수 계산. DB·트랜잭션을 모르므로 단위 테스트로 규칙 전체를 검증할 수 있다.
 *
 * <p>규칙
 * <ul>
 *   <li>팟 = 판돈 × 참가자 수 (참가 시점에 전액 차감돼 있으므로 팟은 이미 에스크로된 돈이다)</li>
 *   <li>달성자끼리 균등 분배. 나누어떨어지지 않는 <b>잔여는 진행분이 가장 큰 승자</b>에게 몰아준다
 *       (동률이면 userId 오름차순 첫 승자) — 증발시키면 팟이 새고, 팟에 남기면 갈 곳이 없다</li>
 *   <li>달성자 0명이면 전원에게 판돈을 그대로 환불한다({@code REFUNDED})</li>
 *   <li>어느 경로든 {@code sum(payout) == pot} 이어야 한다 — 깨지면 계산 버그이므로 예외를 던져
 *       해당 내기 트랜잭션을 롤백시킨다</li>
 * </ul>
 */
public final class GroupBetPayoutCalculator {

    private GroupBetPayoutCalculator() {
    }

    /**
     * 분배 입력 한 줄.
     *
     * @param userId          참가자
     * @param progressMinutes 내기 날짜의 집중 분 — 잔여 배분의 동률 판정에 쓴다
     * @param achieved        목표 달성 여부(진행 분 ≥ 챌린지 목표 분)
     */
    public record Entry(UUID userId, int progressMinutes, boolean achieved) {
    }

    /** 분배 결과 한 줄 — 그대로 참가자 행에 기록된다. */
    public record Payout(UUID userId, boolean achieved, int amount) {
    }

    /** 내기 하나의 분배 결과. */
    public record Distribution(GroupBetStatus status, int pot, List<Payout> payouts) {
    }

    /**
     * @param stake   1인 판돈
     * @param entries 참가자별 달성 판정 (최소 1명)
     * @throws IllegalStateException 참가자가 없거나 {@code sum(payout) != pot} 인 경우
     */
    public static Distribution distribute(int stake, List<Entry> entries) {
        if (entries.isEmpty()) {
            throw new IllegalStateException("참가자가 없는 내기는 정산할 수 없습니다.");
        }

        int pot = stake * entries.size();
        List<Entry> winners = entries.stream().filter(Entry::achieved).toList();

        GroupBetStatus status = winners.isEmpty() ? GroupBetStatus.REFUNDED : GroupBetStatus.SETTLED;
        List<Payout> payouts = winners.isEmpty()
                ? refundAll(stake, entries)
                : share(pot, entries, winners);

        int total = payouts.stream().mapToInt(Payout::amount).sum();
        if (total != pot) {
            throw new IllegalStateException(
                    "내기 분배 불변식 위반 — sum(payout)=" + total + ", pot=" + pot);
        }
        return new Distribution(status, pot, payouts);
    }

    private static List<Payout> refundAll(int stake, List<Entry> entries) {
        return entries.stream()
                .map(e -> new Payout(e.userId(), false, stake))
                .toList();
    }

    private static List<Payout> share(int pot, List<Entry> entries, List<Entry> winners) {
        int share = pot / winners.size();
        int remainder = pot % winners.size();
        UUID remainderWinner = topWinner(winners).userId();

        return entries.stream()
                .map(e -> {
                    if (!e.achieved()) {
                        return new Payout(e.userId(), false, 0);
                    }
                    int amount = share + (e.userId().equals(remainderWinner) ? remainder : 0);
                    return new Payout(e.userId(), true, amount);
                })
                .toList();
    }

    /** 진행분 내림차순 → userId 오름차순의 첫 승자. 잔여를 받을 한 명을 결정적으로 고른다. */
    private static Entry topWinner(List<Entry> winners) {
        return winners.stream()
                .min(Comparator.comparingInt(Entry::progressMinutes).reversed()
                        .thenComparing(Entry::userId))
                .orElseThrow(() -> new IllegalStateException("승자 목록이 비어 있습니다."));
    }
}

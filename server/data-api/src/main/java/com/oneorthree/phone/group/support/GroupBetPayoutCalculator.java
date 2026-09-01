package com.oneorthree.phone.group.support;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * 내기 분배 엔진 — 순수 계산. DB·트랜잭션을 모르므로 단위 테스트로 규칙 전체를 검증할 수 있다.
 *
 * <p>규칙
 * <ul>
 *   <li>팟 = 판돈 × 참가자 수 (참가 시점에 전액 차감돼 있으므로 팟은 이미 에스크로된 돈이다)</li>
 *   <li>달성자끼리 균등 분배. 나누어떨어지지 않는 <b>잔여는 성과가 가장 좋은 승자</b>에게 몰아준다
 *       (동률이면 userId 오름차순 첫 승자) — 증발시키면 팟이 새고, 팟에 남기면 갈 곳이 없다.
 *       "성과가 좋다"의 방향은 카테고리마다 반대라 {@link RemainderRule} 로 받는다</li>
 *   <li>달성자 0명이면 <b>팟 전액 몰수</b>({@code FORFEITED}) — 전원 payout 0. 환불로 되돌리면
 *       "아무도 안 하면 본전"이라 내기의 긴장감이 사라진다(2026-08-02 확정 정책)</li>
 *   <li>불변식은 status 별이다: {@code SETTLED → sum(payout) == pot},
 *       {@code FORFEITED → sum(payout) == 0}. 깨지면 계산 버그이므로 예외를 던져
 *       해당 내기 트랜잭션을 롤백시킨다</li>
 * </ul>
 */
public final class GroupBetPayoutCalculator {

    private GroupBetPayoutCalculator() {
    }

    /**
     * 잔여(나머지) 코인을 받을 승자를 고르는 방향 — 카테고리마다 "성과 1위"의 뜻이 반대다.
     * 판정 소스와 함께 {@link GroupBetJudge#remainderRule} 이 결정한다.
     */
    public enum RemainderRule {
        /** FOCUS — 집중 진행분이 가장 <b>큰</b> 승자. */
        HIGHEST_PROGRESS,
        /** SCREEN_TIME — 사용분이 가장 <b>작은</b> 승자(적게 쓸수록 잘한 것). */
        LOWEST_PROGRESS
    }

    /**
     * 분배 입력 한 줄.
     *
     * @param userId          참가자
     * @param progressMinutes 내기 날짜의 진행 분(FOCUS = 집중 분, SCREEN_TIME = 사용 분)
     *                        — 잔여 배분의 성과 비교에 쓴다
     * @param achieved        목표 달성 여부 — 조합별 판정은 {@link GroupBetJudge#isAchieved} 가 한다
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
     * @param stake         1인 판돈
     * @param remainderRule 잔여를 받을 승자를 고르는 방향(카테고리별)
     * @param entries       참가자별 달성 판정 (최소 1명)
     * @throws IllegalStateException 참가자가 없거나 status 별 분배 불변식이 깨진 경우
     */
    public static Distribution distribute(int stake, RemainderRule remainderRule, List<Entry> entries) {
        if (entries.isEmpty()) {
            throw new IllegalStateException("참가자가 없는 내기는 정산할 수 없습니다.");
        }

        int pot = stake * entries.size();
        List<Entry> winners = entries.stream().filter(Entry::achieved).toList();

        GroupBetStatus status = winners.isEmpty() ? GroupBetStatus.FORFEITED : GroupBetStatus.SETTLED;
        List<Payout> payouts = winners.isEmpty()
                ? forfeitAll(entries)
                : share(pot, entries, winners, remainderRule);

        int total = payouts.stream().mapToInt(Payout::amount).sum();
        int expected = status == GroupBetStatus.FORFEITED ? 0 : pot;
        if (total != expected) {
            throw new IllegalStateException("내기 분배 불변식 위반 — status=" + status
                    + ", sum(payout)=" + total + ", pot=" + pot);
        }
        return new Distribution(status, pot, payouts);
    }

    /** 승자 0명 — 전원 payout 0. 팟은 아무에게도 가지 않고 소멸한다(에스크로에서 회수 불가). */
    private static List<Payout> forfeitAll(List<Entry> entries) {
        return entries.stream()
                .map(e -> new Payout(e.userId(), false, 0))
                .toList();
    }

    private static List<Payout> share(int pot, List<Entry> entries, List<Entry> winners,
            RemainderRule remainderRule) {
        int share = pot / winners.size();
        int remainder = pot % winners.size();
        UUID remainderWinner = topWinner(winners, remainderRule).userId();

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

    /**
     * 성과 1위 → userId 오름차순의 첫 승자. 잔여를 받을 한 명을 결정적으로 고른다.
     * 성과 정렬 방향만 {@code remainderRule} 이 뒤집는다(FOCUS 는 많을수록, SCREEN_TIME 은 적을수록 1위).
     */
    private static Entry topWinner(List<Entry> winners, RemainderRule remainderRule) {
        Comparator<Entry> byPerformance = remainderRule == RemainderRule.LOWEST_PROGRESS
                ? Comparator.comparingInt(Entry::progressMinutes)
                : Comparator.comparingInt(Entry::progressMinutes).reversed();
        return winners.stream()
                .min(byPerformance.thenComparing(Entry::userId))
                .orElseThrow(() -> new IllegalStateException("승자 목록이 비어 있습니다."));
    }
}

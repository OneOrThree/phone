package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 분배 엔진 단위 테스트 — 돈이 새거나 불어나지 않는지가 전부다.
 *
 * <p>모든 케이스에서 {@code sum(payout) == pot} 을 확인한다. 잔여(나머지) 배분·동률 결정성·
 * 승자 0명 환불·단독 참가처럼 규칙이 갈리는 지점을 각각 고정한다.
 */
class GroupBetPayoutCalculatorTest {

    private static final UUID U1 = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID U2 = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID U3 = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final UUID U4 = UUID.fromString("00000000-0000-0000-0000-000000000004");

    private Map<UUID, Integer> amountsOf(GroupBetPayoutCalculator.Distribution distribution) {
        return distribution.payouts().stream()
                .collect(Collectors.toMap(
                        GroupBetPayoutCalculator.Payout::userId,
                        GroupBetPayoutCalculator.Payout::amount));
    }

    private void assertPotConserved(GroupBetPayoutCalculator.Distribution distribution) {
        int total = distribution.payouts().stream()
                .mapToInt(GroupBetPayoutCalculator.Payout::amount).sum();
        assertThat(total).isEqualTo(distribution.pot());
    }

    @Test
    @DisplayName("나누어떨어지면 달성자 균등 분배 — 미달성자는 0")
    void splitsEvenlyAmongWinners() {
        // given: 판돈 30 × 3명 = 팟 90, 달성자 2명
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(30, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 120, true),
                new GroupBetPayoutCalculator.Entry(U2, 100, true),
                new GroupBetPayoutCalculator.Entry(U3, 10, false)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(distribution.pot()).isEqualTo(90);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 45, U2, 45, U3, 0));
        assertPotConserved(distribution);
    }

    @Test
    @DisplayName("나머지는 진행분이 가장 큰 승자에게 몰아준다 — 증발 금지")
    void remainderGoesToTopProgressWinner() {
        // given: 판돈 10 × 4명 = 팟 40, 달성자 3명 → 13씩 + 나머지 1
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(10, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 60, true),
                new GroupBetPayoutCalculator.Entry(U2, 200, true),
                new GroupBetPayoutCalculator.Entry(U3, 90, true),
                new GroupBetPayoutCalculator.Entry(U4, 5, false)));

        assertThat(distribution.pot()).isEqualTo(40);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 13, U2, 14, U3, 13, U4, 0));   // U2 가 최다 진행분
        assertPotConserved(distribution);
    }

    @Test
    @DisplayName("진행분이 동률이면 나머지는 userId 오름차순 첫 승자에게 — 결정적")
    void remainderTieBreaksByUserId() {
        // given: 판돈 10 × 4명 = 팟 40, 달성자 3명 모두 같은 진행분
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(10, List.of(
                new GroupBetPayoutCalculator.Entry(U3, 120, true),
                new GroupBetPayoutCalculator.Entry(U2, 120, true),
                new GroupBetPayoutCalculator.Entry(U1, 120, true),
                new GroupBetPayoutCalculator.Entry(U4, 0, false)));

        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 14, U2, 13, U3, 13, U4, 0));   // 동률 → 가장 작은 U1
        assertPotConserved(distribution);
    }

    @Test
    @DisplayName("달성자 0명이면 REFUNDED — 전원에게 판돈 그대로 환불")
    void refundsEveryoneWhenNoWinner() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(50, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 10, false),
                new GroupBetPayoutCalculator.Entry(U2, 0, false)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.REFUNDED);
        assertThat(distribution.pot()).isEqualTo(100);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(Map.of(U1, 50, U2, 50));
        assertThat(distribution.payouts()).allMatch(p -> !p.achieved());
        assertPotConserved(distribution);
    }

    @Test
    @DisplayName("단독 참가 달성 — 팟(=본인 판돈)을 그대로 회수, 이득도 손실도 없다")
    void soloParticipantAchieved() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(100, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 300, true)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(Map.of(U1, 100));
        assertPotConserved(distribution);
    }

    @Test
    @DisplayName("단독 참가 미달성 — 승자 0명 규칙에 따라 환불된다(몰수 아님)")
    void soloParticipantFailedIsRefunded() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(100, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 0, false)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.REFUNDED);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(Map.of(U1, 100));
        assertPotConserved(distribution);
    }

    @Test
    @DisplayName("달성 판정은 그대로 결과에 실린다 — 참가자 행에 기록될 값")
    void carriesAchievedFlagPerParticipant() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(30, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 120, true),
                new GroupBetPayoutCalculator.Entry(U2, 10, false)));

        assertThat(distribution.payouts())
                .extracting(GroupBetPayoutCalculator.Payout::userId,
                        GroupBetPayoutCalculator.Payout::achieved)
                .containsExactlyInAnyOrder(tuple(U1, true), tuple(U2, false));
    }

    @Test
    @DisplayName("참가자 0명은 정산 불가 — 개설자 자동 참가가 깨졌다는 뜻이라 예외로 롤백시킨다")
    void rejectsEmptyParticipants() {
        assertThatThrownBy(() -> GroupBetPayoutCalculator.distribute(30, List.of()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("참가자 수·달성자 수를 바꿔가며 팟 보존 불변식이 항상 성립한다")
    void potIsAlwaysConserved() {
        List<UUID> users = List.of(U1, U2, U3, U4);
        for (int stake : List.of(10, 30, 50, 100)) {
            for (int size = 1; size <= users.size(); size++) {
                for (int winners = 0; winners <= size; winners++) {
                    List<GroupBetPayoutCalculator.Entry> entries = new ArrayList<>();
                    for (int i = 0; i < size; i++) {
                        entries.add(new GroupBetPayoutCalculator.Entry(users.get(i), i * 10, i < winners));
                    }
                    assertPotConserved(GroupBetPayoutCalculator.distribute(stake, entries));
                }
            }
        }
    }
}

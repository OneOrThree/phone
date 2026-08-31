package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
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
 * <p>모든 케이스에서 status 별 불변식({@code SETTLED → sum(payout) == pot},
 * {@code FORFEITED → sum(payout) == 0})을 확인한다. 잔여(나머지) 배분·동률 결정성·
 * 승자 0명 몰수·단독 참가처럼 규칙이 갈리는 지점을 각각 고정한다.
 */
class GroupBetPayoutCalculatorTest {

    /** FOCUS 방향 — 진행분이 클수록 성과 1위. 대부분의 케이스가 이 방향이다. */
    private static final GroupBetPayoutCalculator.RemainderRule HIGHEST =
            GroupBetPayoutCalculator.RemainderRule.HIGHEST_PROGRESS;
    /** SCREEN_TIME 방향 — 사용분이 작을수록 성과 1위. */
    private static final GroupBetPayoutCalculator.RemainderRule LOWEST =
            GroupBetPayoutCalculator.RemainderRule.LOWEST_PROGRESS;

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

    /** status 별 불변식 — SETTLED 는 팟 보존, FORFEITED 는 지급 합 0(팟 전액 소멸). */
    private void assertInvariantHolds(GroupBetPayoutCalculator.Distribution distribution) {
        int total = distribution.payouts().stream()
                .mapToInt(GroupBetPayoutCalculator.Payout::amount).sum();
        int expected = distribution.status() == GroupBetStatus.FORFEITED ? 0 : distribution.pot();
        assertThat(total).isEqualTo(expected);
    }

    @Test
    @DisplayName("나누어떨어지면 달성자 균등 분배 — 미달성자는 0")
    void splitsEvenlyAmongWinners() {
        // given: 판돈 30 × 3명 = 팟 90, 달성자 2명
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(30, HIGHEST, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 120, true),
                new GroupBetPayoutCalculator.Entry(U2, 100, true),
                new GroupBetPayoutCalculator.Entry(U3, 10, false)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(distribution.pot()).isEqualTo(90);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 45, U2, 45, U3, 0));
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("나머지는 진행분이 가장 큰 승자에게 몰아준다 — 증발 금지")
    void remainderGoesToTopProgressWinner() {
        // given: 판돈 10 × 4명 = 팟 40, 달성자 3명 → 13씩 + 나머지 1
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(10, HIGHEST, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 60, true),
                new GroupBetPayoutCalculator.Entry(U2, 200, true),
                new GroupBetPayoutCalculator.Entry(U3, 90, true),
                new GroupBetPayoutCalculator.Entry(U4, 5, false)));

        assertThat(distribution.pot()).isEqualTo(40);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 13, U2, 14, U3, 13, U4, 0));   // U2 가 최다 진행분
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("진행분이 동률이면 나머지는 userId 오름차순 첫 승자에게 — 결정적")
    void remainderTieBreaksByUserId() {
        // given: 판돈 10 × 4명 = 팟 40, 달성자 3명 모두 같은 진행분
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(10, HIGHEST, List.of(
                new GroupBetPayoutCalculator.Entry(U3, 120, true),
                new GroupBetPayoutCalculator.Entry(U2, 120, true),
                new GroupBetPayoutCalculator.Entry(U1, 120, true),
                new GroupBetPayoutCalculator.Entry(U4, 0, false)));

        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 14, U2, 13, U3, 13, U4, 0));   // 동률 → 가장 작은 U1
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("SCREEN_TIME 방향에서는 나머지가 사용분이 가장 '작은' 승자에게 간다 — 비교 방향 반전")
    void remainderGoesToLowestUsageWinnerForScreenTime() {
        // given: 판돈 10 × 4명 = 팟 40, 달성자 3명 → 13씩 + 나머지 1.
        // 스크린타임은 적게 쓸수록 잘한 것이라 U3(30분)가 성과 1위다.
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(10, LOWEST, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 60, true),
                new GroupBetPayoutCalculator.Entry(U2, 200, true),
                new GroupBetPayoutCalculator.Entry(U3, 30, true),
                new GroupBetPayoutCalculator.Entry(U4, 500, false)));

        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 13, U2, 13, U3, 14, U4, 0));
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("같은 입력이라도 방향이 다르면 나머지를 받는 승자가 갈린다 — 파라미터가 실제로 먹는다")
    void remainderWinnerFlipsWithRule() {
        List<GroupBetPayoutCalculator.Entry> entries = List.of(
                new GroupBetPayoutCalculator.Entry(U1, 10, true),
                new GroupBetPayoutCalculator.Entry(U2, 20, true),
                new GroupBetPayoutCalculator.Entry(U3, 30, true));

        // 팟 30, 승자 3명 → 10씩 + 나머지 0 이면 방향 차이가 안 보이므로 나머지가 남는 판돈을 쓴다.
        assertThat(amountsOf(GroupBetPayoutCalculator.distribute(50, HIGHEST, entries)))
                .containsExactlyInAnyOrderEntriesOf(Map.of(U1, 50, U2, 50, U3, 50));
        assertThat(amountsOf(GroupBetPayoutCalculator.distribute(10, HIGHEST, entries)).get(U3)).isEqualTo(10);
        assertThat(amountsOf(GroupBetPayoutCalculator.distribute(10, LOWEST, entries)).get(U1)).isEqualTo(10);
    }

    @Test
    @DisplayName("SCREEN_TIME 방향에서도 동률이면 userId 오름차순 첫 승자 — 결정적")
    void lowestRuleTieBreaksByUserId() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(10, LOWEST, List.of(
                new GroupBetPayoutCalculator.Entry(U3, 40, true),
                new GroupBetPayoutCalculator.Entry(U2, 40, true),
                new GroupBetPayoutCalculator.Entry(U1, 40, true),
                new GroupBetPayoutCalculator.Entry(U4, 999, false)));

        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(
                Map.of(U1, 14, U2, 13, U3, 13, U4, 0));
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("달성자 0명이면 FORFEITED — 전원 payout 0, 팟 전액 소멸(환불 없음)")
    void forfeitsEveryoneWhenNoWinner() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(50, HIGHEST, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 10, false),
                new GroupBetPayoutCalculator.Entry(U2, 0, false)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.FORFEITED);
        assertThat(distribution.pot()).isEqualTo(100);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(Map.of(U1, 0, U2, 0));
        assertThat(distribution.payouts()).allMatch(p -> !p.achieved());
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("단독 참가 달성 — 팟(=본인 판돈)을 그대로 회수, 이득도 손실도 없다")
    void soloParticipantAchieved() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(100, HIGHEST, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 300, true)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(Map.of(U1, 100));
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("단독 참가 미달성 — 승자 0명 규칙 그대로 몰수된다(판돈 소멸)")
    void soloParticipantFailedIsForfeited() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(100, HIGHEST, List.of(
                new GroupBetPayoutCalculator.Entry(U1, 0, false)));

        assertThat(distribution.status()).isEqualTo(GroupBetStatus.FORFEITED);
        assertThat(amountsOf(distribution)).containsExactlyInAnyOrderEntriesOf(Map.of(U1, 0));
        assertInvariantHolds(distribution);
    }

    @Test
    @DisplayName("달성 판정은 그대로 결과에 실린다 — 참가자 행에 기록될 값")
    void carriesAchievedFlagPerParticipant() {
        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(30, HIGHEST, List.of(
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
        assertThatThrownBy(() -> GroupBetPayoutCalculator.distribute(30, HIGHEST, List.of()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("참가자 수·달성자 수를 바꿔가며 status 별 분배 불변식이 항상 성립한다")
    void invariantAlwaysHolds() {
        List<UUID> users = List.of(U1, U2, U3, U4);
        for (int stake : List.of(10, 30, 50, 100)) {
            for (int size = 1; size <= users.size(); size++) {
                for (int winners = 0; winners <= size; winners++) {
                    List<GroupBetPayoutCalculator.Entry> entries = new ArrayList<>();
                    for (int i = 0; i < size; i++) {
                        entries.add(new GroupBetPayoutCalculator.Entry(users.get(i), i * 10, i < winners));
                    }
                    assertInvariantHolds(GroupBetPayoutCalculator.distribute(stake, HIGHEST, entries));
                    assertInvariantHolds(GroupBetPayoutCalculator.distribute(stake, LOWEST, entries));
                }
            }
        }
    }
}

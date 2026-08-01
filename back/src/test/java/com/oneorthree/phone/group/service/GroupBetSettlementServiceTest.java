package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;

/**
 * 배치 요약 집계 단위 테스트 — "몇 건을 실제로 정산했는가"를 정확히 세는지만 본다.
 *
 * <p>지급이 실제로 한 번만 일어나는지는 {@link GroupBetSettlementIntegrationTest} 가 실 DB 로 고정한다.
 * 여기서 따로 보는 이유는, 동시 실행에서 CAS 에 밀린 호출도 최종 상태(SETTLED/REFUNDED)를 돌려주기
 * 때문에 상태만 보고 세면 <b>같은 내기를 양쪽 실행이 각자 성과로 세어</b> 요약·지표가 부풀려지기 때문이다
 * (PR #381 리뷰).
 */
@ExtendWith(MockitoExtension.class)
class GroupBetSettlementServiceTest {

    @InjectMocks
    private GroupBetSettlementService groupBetSettlementService;

    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;

    @Mock
    private GroupBetSettler groupBetSettler;

    private static final LocalDate TODAY = LocalDate.of(2026, 8, 1);

    private void givenTargets(UUID... betIds) {
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(GroupBetStatus.OPEN, TODAY))
                .willReturn(List.of(betIds));
    }

    @Test
    @DisplayName("이번 실행이 지급한 건만 분배/환불로 센다")
    void countsAppliedSettlementsOnly() {
        UUID settledBet = UUID.randomUUID();
        UUID refundedBet = UUID.randomUUID();
        givenTargets(settledBet, refundedBet);
        given(groupBetSettler.settle(settledBet))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));
        given(groupBetSettler.settle(refundedBet))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.REFUNDED, true));

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(TODAY);

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.refundedCount()).isEqualTo(1);
        assertThat(summary.skippedCount()).isZero();
        assertThat(summary.failedCount()).isZero();
    }

    @Test
    @DisplayName("동시 실행에서 밀린 건(applied=false)은 성공이 아니라 스킵으로 센다")
    void countsConcurrentLoserAsSkipped() {
        UUID betId = UUID.randomUUID();
        givenTargets(betId);
        // 다른 실행이 먼저 정산해 상태는 SETTLED 지만, 이 호출은 지급을 적용하지 않았다.
        given(groupBetSettler.settle(betId))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, false));

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(TODAY);

        assertThat(summary.settledCount()).isZero();
        assertThat(summary.refundedCount()).isZero();
        assertThat(summary.skippedCount()).isEqualTo(1);
        assertThat(summary.failedCount()).isZero();
    }

    @Test
    @DisplayName("한 건이 터져도 나머지는 계속 정산되고, 실패만 따로 센다")
    void isolatesFailureToSingleBet() {
        UUID failing = UUID.randomUUID();
        UUID healthy = UUID.randomUUID();
        givenTargets(failing, healthy);
        willThrow(new IllegalStateException("불변식 위반")).given(groupBetSettler).settle(failing);
        given(groupBetSettler.settle(healthy))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(TODAY);

        assertThat(summary.failedCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.skippedCount()).isZero();
    }
}

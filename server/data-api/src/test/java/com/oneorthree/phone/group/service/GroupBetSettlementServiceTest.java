package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.SettleTrigger;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 수동(MANUAL) 배치 요약 집계 단위 테스트 — "몇 건을 실제로 정산했는가"를 정확히 세는지만 본다.
 *
 * <p>지급이 실제로 한 번만 일어나는지는 {@link GroupBetSettlementIntegrationTest} 가 실 DB 로 고정한다.
 * 여기서 따로 보는 이유는, 동시 실행에서 CAS 에 밀린 호출도 최종 상태(SETTLED/FORFEITED)를 돌려주기
 * 때문에 상태만 보고 세면 <b>같은 내기를 양쪽 실행이 각자 성과로 세어</b> 요약·지표가 부풀려지기 때문이다
 * (PR #381 리뷰).
 *
 * <p>대상 선택은 <b>회차별 {@code settle_after} 경과</b>다(GROMO-1411 후속) — 날짜 축이던 종전
 * 선택은 당일 회차(오전 창형 등)를 못 잡아 24h 자동 환불 전의 수동 복구가 불가능했다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetSettlementServiceTest {

    @InjectMocks
    private GroupBetSettlementService groupBetSettlementService;

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    @Mock
    private GroupBetSettler groupBetSettler;

    private static final Instant NOW = Instant.parse("2026-08-10T03:00:00Z");

    private void givenTargets(UUID... sessionIds) {
        given(groupChallengeBetSessionRepository
                .findIdsByStatusAndSettleAfterBefore(GroupBetStatus.OPEN, NOW))
                .willReturn(List.of(sessionIds));
    }

    @Test
    @DisplayName("이번 실행이 지급/몰수한 건만 분배/몰수로 센다 — 환불 없는 배치의 refunded 는 0")
    void countsAppliedSettlementsOnly() {
        UUID settledBet = UUID.randomUUID();
        UUID forfeitedBet = UUID.randomUUID();
        givenTargets(settledBet, forfeitedBet);
        given(groupBetSettler.settle(settledBet, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));
        given(groupBetSettler.settle(forfeitedBet, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.FORFEITED, true));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(NOW, null);

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.forfeitedCount()).isEqualTo(1);
        assertThat(summary.refundedCount()).isZero();
        assertThat(summary.skippedCount()).isZero();
        assertThat(summary.failedCount()).isZero();
    }

    @Test
    @DisplayName("동시 실행에서 밀린 건(applied=false)은 성공이 아니라 스킵으로 센다")
    void countsConcurrentLoserAsSkipped() {
        UUID betId = UUID.randomUUID();
        givenTargets(betId);
        // 다른 실행이 먼저 정산해 상태는 SETTLED 지만, 이 호출은 지급을 적용하지 않았다.
        given(groupBetSettler.settle(betId, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, false));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(NOW, null);

        assertThat(summary.settledCount()).isZero();
        assertThat(summary.forfeitedCount()).isZero();
        assertThat(summary.skippedCount()).isEqualTo(1);
        assertThat(summary.failedCount()).isZero();
    }

    @Test
    @DisplayName("24h 데드라인 자동 전원 환불(N21)은 refunded 버킷으로 따로 센다")
    void countsDeadlineRefundSeparately() {
        UUID expired = UUID.randomUUID();
        givenTargets(expired);
        given(groupBetSettler.settle(expired, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.REFUNDED, true));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(NOW, null);

        assertThat(summary.refundedCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isZero();
        assertThat(summary.skippedCount()).isZero();
    }

    @Test
    @DisplayName("한 건이 터져도 나머지는 계속 정산되고, 실패만 따로 센다")
    void isolatesFailureToSingleBet() {
        UUID failing = UUID.randomUUID();
        UUID healthy = UUID.randomUUID();
        givenTargets(failing, healthy);
        willThrow(new IllegalStateException("불변식 위반"))
                .given(groupBetSettler).settle(failing, SettleTrigger.MANUAL);
        given(groupBetSettler.settle(healthy, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(NOW, null);

        assertThat(summary.failedCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.skippedCount()).isZero();
    }

    @Test
    @DisplayName("UNUSED(참가자 0명 종료)는 성과 버킷이 아니라 스킵으로 센다 — 요약 합계 보존 (GROMO-1404)")
    void countsUnusedCloseAsSkipped() {
        UUID emptySession = UUID.randomUUID();
        givenTargets(emptySession);
        given(groupBetSettler.settle(emptySession, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.UNUSED, true));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(NOW, null);

        assertThat(summary.settledCount()).isZero();
        assertThat(summary.forfeitedCount()).isZero();
        assertThat(summary.skippedCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("카테고리를 주면 그 카테고리 대상만 조회한다 — 전체 조회는 타지 않는다")
    void settlesOnlyRequestedCategory() {
        UUID focusBet = UUID.randomUUID();
        given(groupChallengeBetSessionRepository.findIdsByStatusAndSettleAfterBeforeAndCategory(
                GroupBetStatus.OPEN, NOW, MissionCategory.FOCUS)).willReturn(List.of(focusBet));
        given(groupBetSettler.settle(focusBet, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(NOW, MissionCategory.FOCUS);

        assertThat(summary.targetCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isEqualTo(1);
        verify(groupChallengeBetSessionRepository, never())
                .findIdsByStatusAndSettleAfterBefore(any(), any());
    }

    @Test
    @DisplayName("카테고리가 null 이면 전 카테고리 — 수동 트리거의 기본 동작")
    void settlesAllCategoriesWhenUnspecified() {
        UUID betId = UUID.randomUUID();
        givenTargets(betId);
        given(groupBetSettler.settle(betId, SettleTrigger.MANUAL))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.FORFEITED, true));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(NOW, null);

        assertThat(summary.forfeitedCount()).isEqualTo(1);
        verify(groupChallengeBetSessionRepository, never())
                .findIdsByStatusAndSettleAfterBeforeAndCategory(any(), any(), any());
    }
}

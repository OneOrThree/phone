package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 배치 요약 집계 단위 테스트 — "몇 건을 실제로 정산했는가"를 정확히 세는지만 본다.
 *
 * <p>지급이 실제로 한 번만 일어나는지는 {@link GroupBetSettlementIntegrationTest} 가 실 DB 로 고정한다.
 * 여기서 따로 보는 이유는, 동시 실행에서 CAS 에 밀린 호출도 최종 상태(SETTLED/FORFEITED)를 돌려주기
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
    @DisplayName("이번 실행이 지급/몰수한 건만 분배/몰수로 센다 — refunded 는 레거시 버킷이라 항상 0")
    void countsAppliedSettlementsOnly() {
        UUID settledBet = UUID.randomUUID();
        UUID forfeitedBet = UUID.randomUUID();
        givenTargets(settledBet, forfeitedBet);
        given(groupBetSettler.settle(settledBet))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));
        given(groupBetSettler.settle(forfeitedBet))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.FORFEITED, true));

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(TODAY);

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
        given(groupBetSettler.settle(betId))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, false));

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(TODAY);

        assertThat(summary.settledCount()).isZero();
        assertThat(summary.forfeitedCount()).isZero();
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

    // ── 카테고리 분리(크론 2회) ──────────────────────────────────────────
    // 01:00 은 FOCUS, 12:00 은 SCREEN_TIME 만 집는다 — 스크린타임을 01:00 에 집으면 아침 보고 전이라
    // 미보고=미달성 억울 패배가 양산된다.

    @Test
    @DisplayName("카테고리를 주면 그 카테고리 대상만 조회한다 — 전체 조회는 타지 않는다")
    void settlesOnlyRequestedCategory() {
        UUID focusBet = UUID.randomUUID();
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBeforeAndCategory(
                GroupBetStatus.OPEN, TODAY, MissionCategory.FOCUS)).willReturn(List.of(focusBet));
        given(groupBetSettler.settle(focusBet))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(TODAY, MissionCategory.FOCUS);

        assertThat(summary.targetCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isEqualTo(1);
        verify(groupChallengeBetRepository, never())
                .findIdsByStatusAndBetDateBefore(any(), any());
    }

    @Test
    @DisplayName("카테고리가 null 이면 전 카테고리 — 수동 트리거의 기본 동작")
    void settlesAllCategoriesWhenUnspecified() {
        UUID betId = UUID.randomUUID();
        givenTargets(betId);
        given(groupBetSettler.settle(betId))
                .willReturn(new GroupBetSettler.SettleResult(GroupBetStatus.FORFEITED, true));

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(TODAY, null);

        assertThat(summary.forfeitedCount()).isEqualTo(1);
        verify(groupChallengeBetRepository, never())
                .findIdsByStatusAndBetDateBeforeAndCategory(any(), any(), any());
    }

    // ── 정산 기준일(그레이스 1h) ─────────────────────────────────────────
    // 수동 트리거가 00:00~01:00 KST 에 호출돼도 그레이스가 안 끝난 전일자를 앞당겨 정산하면 안 된다.

    @Test
    @DisplayName("01:00 KST 정각(FOCUS 스케줄 시각)의 기준일은 그날 — 전일자가 대상이 된다")
    void settlementDateAtCutoffIsToday() {
        // 2026-08-02 01:00 KST = 2026-08-01 16:00 UTC
        Instant cutoff = Instant.parse("2026-08-01T16:00:00Z");

        assertThat(GroupBetSettlementService.settlementDateAt(cutoff))
                .isEqualTo(LocalDate.of(2026, 8, 2));
    }

    @Test
    @DisplayName("00:59 KST 수동 호출의 기준일은 전날 — 전일자 내기는 그레이스가 끝날 때까지 제외된다")
    void settlementDateBeforeCutoffIsYesterday() {
        // 2026-08-02 00:59 KST = 2026-08-01 15:59 UTC
        Instant beforeCutoff = Instant.parse("2026-08-01T15:59:00Z");

        assertThat(GroupBetSettlementService.settlementDateAt(beforeCutoff))
                .isEqualTo(LocalDate.of(2026, 8, 1));
    }

    @Test
    @DisplayName("12:00 KST(SCREEN_TIME 스케줄 시각)의 기준일도 그날 — 그레이스가 한참 지난 시각이다")
    void settlementDateAtNoonIsToday() {
        // 2026-08-02 12:00 KST = 2026-08-02 03:00 UTC
        Instant noon = Instant.parse("2026-08-02T03:00:00Z");

        assertThat(GroupBetSettlementService.settlementDateAt(noon))
                .isEqualTo(LocalDate.of(2026, 8, 2));
    }
}

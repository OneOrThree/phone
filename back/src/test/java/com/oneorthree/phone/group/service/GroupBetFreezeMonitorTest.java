package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 동결 감지의 <b>기준일 경계</b>와 <b>처분(24h 자동 환불)</b> 단위 테스트 — 어제 내기는 아직 오늘
 * 배치의 대상이라 정상이고, 그제 것이 OPEN 이면 배치를 한 번 이상 걸렀다는 뜻이다.
 *
 * <p>환불 자체의 정합(REFUNDED 전이·멱등키·전원 환불)은 {@code GroupBetService} 단위 테스트와
 * {@code GroupBetFrozenRefundIntegrationTest} 가 맡는다 — 여기서는 스윕의 <b>격리 규율</b>만 본다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetFreezeMonitorTest {

    /** 2026-08-02 09:00 KST = 2026-08-02 00:00 UTC. */
    private static final Instant NOW = Instant.parse("2026-08-02T00:00:00Z");

    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;
    @Mock
    private GroupBetService groupBetService;
    @InjectMocks
    private GroupBetFreezeMonitor monitor;

    @Test
    @DisplayName("bet_date ≤ 오늘−2 만 조회한다 — 어제 내기는 아직 정산 대상이라 제외")
    void queriesOnlyBetsOlderThanYesterday() {
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(eq(GroupBetStatus.OPEN), any()))
                .willReturn(List.of());

        monitor.detectFrozenBets(NOW);

        ArgumentCaptor<LocalDate> captor = ArgumentCaptor.forClass(LocalDate.class);
        verify(groupChallengeBetRepository)
                .findIdsByStatusAndBetDateBefore(eq(GroupBetStatus.OPEN), captor.capture());
        // beforeDate 미만 = 2026-08-01 미만 = 7/31 이하 = 오늘(8/2) − 2 이하
        assertThat(captor.getValue()).isEqualTo(LocalDate.of(2026, 8, 1));
    }

    @Test
    @DisplayName("동결 건이 없으면 0")
    void returnsZeroWhenNothingFrozen() {
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(any(), any()))
                .willReturn(List.of());

        assertThat(monitor.detectFrozenBets(NOW)).isZero();
    }

    @Test
    @DisplayName("동결 건 수를 그대로 돌려준다 — 로그 상한을 넘겨도 카운트는 전건")
    void returnsFrozenCount() {
        List<UUID> frozen = java.util.stream.IntStream
                .range(0, GroupBetFreezeMonitor.LOGGED_BET_ID_LIMIT + 5)
                .mapToObj(index -> UUID.randomUUID())
                .toList();
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(any(), any()))
                .willReturn(frozen);

        assertThat(monitor.detectFrozenBets(NOW)).isEqualTo(frozen.size());
    }

    // ── 처분 (정책 §E1, GROMO-1258) ──────────────────────────────────────

    @Test
    @DisplayName("동결 건이 없으면 환불 호출 자체가 없다")
    void sweepDoesNothingWhenNothingFrozen() {
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(any(), any()))
                .willReturn(List.of());

        assertThat(monitor.sweepFrozenBets(NOW))
                .isEqualTo(new GroupBetFreezeMonitor.FrozenSweepSummary(0, 0, 0));
        verifyNoInteractions(groupBetService);
    }

    @Test
    @DisplayName("감지한 회차를 id 오름차순으로 전부 환불에 넘긴다 — 감지만 하고 끝나던 종전 동작 교체")
    void sweepRefundsEveryFrozenBetInIdOrder() {
        UUID first = UUID.fromString("00000000-0000-0000-0000-0000000000b1");
        UUID second = UUID.fromString("00000000-0000-0000-0000-0000000000b2");
        // 조회 순서(bet_date, id)와 무관하게 잠금 순서 규약(내기 id 오름차순)으로 처분해야 한다.
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(any(), any()))
                .willReturn(List.of(second, first));
        given(groupBetService.refundFrozenBet(any())).willReturn(true);

        assertThat(monitor.sweepFrozenBets(NOW))
                .isEqualTo(new GroupBetFreezeMonitor.FrozenSweepSummary(2, 2, 0));
        InOrder byId = inOrder(groupBetService);
        byId.verify(groupBetService).refundFrozenBet(first);
        byId.verify(groupBetService).refundFrozenBet(second);
    }

    @Test
    @DisplayName("한 건이 터져도 나머지 환불은 계속된다 — 건별 격리(정산 배치와 같은 규율)")
    void sweepIsolatesFailurePerBet() {
        UUID failing = UUID.fromString("00000000-0000-0000-0000-0000000000b1");
        UUID healthy = UUID.fromString("00000000-0000-0000-0000-0000000000b2");
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(any(), any()))
                .willReturn(List.of(failing, healthy));
        willThrow(new IllegalStateException("지갑 없음")).given(groupBetService).refundFrozenBet(failing);
        given(groupBetService.refundFrozenBet(healthy)).willReturn(true);

        assertThat(monitor.sweepFrozenBets(NOW))
                .isEqualTo(new GroupBetFreezeMonitor.FrozenSweepSummary(2, 1, 1));
    }

    @Test
    @DisplayName("이미 다른 경로가 닫은 회차(false)는 환불 건수에 세지 않는다")
    void sweepDoesNotCountAlreadyClosedBets() {
        UUID betId = UUID.fromString("00000000-0000-0000-0000-0000000000b1");
        given(groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(any(), any()))
                .willReturn(List.of(betId));
        given(groupBetService.refundFrozenBet(betId)).willReturn(false);

        assertThat(monitor.sweepFrozenBets(NOW))
                .isEqualTo(new GroupBetFreezeMonitor.FrozenSweepSummary(1, 0, 0));
    }
}

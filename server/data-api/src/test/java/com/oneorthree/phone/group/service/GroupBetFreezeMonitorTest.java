package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
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
import static org.mockito.Mockito.verify;

/**
 * 동결 감지의 <b>기준일 경계</b> 단위 테스트 — 어제 회차는 아직 오늘 배치의 대상이라 정상이고,
 * 그제 것이 OPEN 이면 배치를 한 번 이상 걸렀다는 뜻이다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetFreezeMonitorTest {

    /** 2026-08-02 09:00 KST = 2026-08-02 00:00 UTC. */
    private static final Instant NOW = Instant.parse("2026-08-02T00:00:00Z");

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @InjectMocks
    private GroupBetFreezeMonitor monitor;

    @Test
    @DisplayName("session_date ≤ 오늘−2 만 조회한다 — 어제 회차는 아직 정산 대상이라 제외")
    void queriesOnlyBetsOlderThanYesterday() {
        given(groupChallengeBetSessionRepository.findIdsByStatusAndSessionDateBefore(eq(GroupBetStatus.OPEN), any()))
                .willReturn(List.of());

        monitor.detectFrozenBets(NOW);

        ArgumentCaptor<LocalDate> captor = ArgumentCaptor.forClass(LocalDate.class);
        verify(groupChallengeBetSessionRepository)
                .findIdsByStatusAndSessionDateBefore(eq(GroupBetStatus.OPEN), captor.capture());
        // beforeDate 미만 = 2026-08-01 미만 = 7/31 이하 = 오늘(8/2) − 2 이하
        assertThat(captor.getValue()).isEqualTo(LocalDate.of(2026, 8, 1));
    }

    @Test
    @DisplayName("동결 건이 없으면 0")
    void returnsZeroWhenNothingFrozen() {
        given(groupChallengeBetSessionRepository.findIdsByStatusAndSessionDateBefore(any(), any()))
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
        given(groupChallengeBetSessionRepository.findIdsByStatusAndSessionDateBefore(any(), any()))
                .willReturn(frozen);

        assertThat(monitor.detectFrozenBets(NOW)).isEqualTo(frozen.size());
    }
}

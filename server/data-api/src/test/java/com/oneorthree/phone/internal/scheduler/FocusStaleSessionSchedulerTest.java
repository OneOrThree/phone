package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Limit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;

/**
 * 방치 세션 종결 크론의 스캔 경계와 건별 격리 (GROMO-2636).
 *
 * <p>«섬 12시간 · 바다 3시간 · 한 틱 50건» 이 어디서 오는지가 여기서 잠긴다. 잠금·재판정·종결 상태는
 * {@code FocusStaleSessionCloseIntegrationTest} 가 실제 Flyway PostgreSQL 위에서 본다 — 그쪽이 DB 규칙이라 mock 으로는
 * 의미가 없다.
 */
@ExtendWith(MockitoExtension.class)
class FocusStaleSessionSchedulerTest {

    private static final Instant NOW = Instant.parse("2026-11-01T03:04:05Z");

    @Mock
    private FocusSessionDetailRepository details;
    @Mock
    private FocusSessionLifecycleService lifecycle;

    private FocusStaleSessionScheduler scheduler() {
        return new FocusStaleSessionScheduler(details, lifecycle, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("스캔 경계는 섬 «지금 − 12시간», 바다 «지금 − 3시간» 이고 한 틱은 50건까지다")
    void theScanCutoffsAreTwelveHoursForIslandsAndThreeForTheSea() {
        given(details.findStaleActiveSessionIds(any(), any(), any())).willReturn(List.of());

        scheduler().closeStaleSessions();

        ArgumentCaptor<Instant> island = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> sea = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Limit> limit = ArgumentCaptor.forClass(Limit.class);
        verify(details).findStaleActiveSessionIds(island.capture(), sea.capture(), limit.capture());
        assertThat(island.getValue()).isEqualTo(NOW.minus(Duration.ofHours(12)));
        assertThat(sea.getValue()).isEqualTo(NOW.minus(Duration.ofHours(3)));
        assertThat(limit.getValue().max()).isEqualTo(50);
        assertThat(FocusSessionLifecycleService.ISLAND_STALE_AFTER)
                .as("계약의 «섬 12시간» — 값이 바뀌면 여기서 드러난다").isEqualTo(Duration.ofHours(12));
        assertThat(FocusSessionLifecycleService.SEA_STALE_AFTER)
                .as("계약의 «바다 3시간»").isEqualTo(Duration.ofHours(3));
    }

    @Test
    @DisplayName("한 세션이 터져도 나머지는 계속 종결한다 — 다음 틱이 그 세션을 다시 집는다")
    void oneFailingSessionDoesNotStopTheRest() {
        UUID broken = UUID.randomUUID();
        UUID healthy = UUID.randomUUID();
        given(details.findStaleActiveSessionIds(any(), any(), any())).willReturn(List.of(broken, healthy));
        given(lifecycle.autoCloseStale(broken)).willThrow(new IllegalStateException("터졌다"));

        scheduler().closeStaleSessions();

        verify(lifecycle).autoCloseStale(healthy);
    }
}

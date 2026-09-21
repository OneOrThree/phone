package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

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
 * 휴식 자동 종료 크론의 스캔 경계와 건별 격리 (GROMO-1998).
 *
 * <p>「1시간」이 어디서 오는지와 「한 세션이 터져도 나머지는 돈다」가 여기서 잠긴다. 잠금·재판정·정산은
 * {@code FocusSessionActivationIntegrationTest} 가 실제 Flyway PostgreSQL 위에서 본다 — 그쪽이 DB 규칙이라
 * mock 으로는 의미가 없다.
 */
@ExtendWith(MockitoExtension.class)
class FocusRestAutoCloseSchedulerTest {

    private static final Instant NOW = Instant.parse("2026-09-21T03:04:05Z");

    @Mock
    private FocusSessionDetailRepository details;
    @Mock
    private FocusSessionLifecycleService lifecycle;

    private FocusRestAutoCloseScheduler scheduler() {
        return new FocusRestAutoCloseScheduler(details, lifecycle, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("스캔 경계는 «지금 − 1시간» 이다 — 유예는 휴식을 누른 순간부터 센다")
    void theScanCutoffIsExactlyOneHourBeforeNow() {
        given(details.findSessionIdsRestingSince(any())).willReturn(List.of());

        scheduler().closeTimedOutRests();

        ArgumentCaptor<Instant> cutoff = ArgumentCaptor.forClass(Instant.class);
        verify(details).findSessionIdsRestingSince(cutoff.capture());
        assertThat(cutoff.getValue()).isEqualTo(NOW.minus(Duration.ofHours(1)));
        assertThat(FocusSessionLifecycleService.REST_AUTO_CLOSE_AFTER)
                .as("정책 정본의 「휴식하기를 누른 순간부터 1시간」 — 값이 바뀌면 여기서 드러난다")
                .isEqualTo(Duration.ofHours(1));
    }

    @Test
    @DisplayName("한 세션이 터져도 나머지는 계속 종결한다 — 다음 틱이 그 세션을 다시 집는다")
    void oneFailingSessionDoesNotStopTheRest() {
        UUID broken = UUID.randomUUID();
        UUID healthy = UUID.randomUUID();
        given(details.findSessionIdsRestingSince(any())).willReturn(List.of(broken, healthy));
        given(lifecycle.autoCloseTimedOutRest(broken)).willThrow(new IllegalStateException("터졌다"));

        scheduler().closeTimedOutRests();

        verify(lifecycle).autoCloseTimedOutRest(healthy);
    }
}

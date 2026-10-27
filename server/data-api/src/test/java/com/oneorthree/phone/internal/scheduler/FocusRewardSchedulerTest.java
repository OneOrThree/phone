package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.internal.service.FocusRewardAccrualService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;

/**
 * 분당 적립 크론 (GROMO-1990) — 진행 중 세션을 훑어 적립한다. 단계 활성화 스위치는 2026-10-27(티켓 2535)에 걷었다.
 */
@ExtendWith(MockitoExtension.class)
class FocusRewardSchedulerTest {

    @Mock
    private FocusSessionDetailRepository details;
    @Mock
    private FocusRewardAccrualService accruals;

    @Test
    @DisplayName("진행 중(ACTIVE) 세션만 훑어 적립한다")
    void accruesEveryActiveSession() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        given(details.findSessionIdsByLifecycle(FocusSessionLifecycle.ACTIVE))
                .willReturn(List.of(first, second));

        new FocusRewardScheduler(details, accruals).accrueDueSessions();

        verify(accruals).accrue(first);
        verify(accruals).accrue(second);
    }

    @Test
    @DisplayName("한 세션이 터져도 나머지는 계속 적립한다 — 다음 틱이 그 세션을 다시 집는다")
    void oneFailingSessionDoesNotStopTheRest() {
        UUID broken = UUID.randomUUID();
        UUID healthy = UUID.randomUUID();
        given(details.findSessionIdsByLifecycle(any())).willReturn(List.of(broken, healthy));
        given(accruals.accrue(broken)).willThrow(new IllegalStateException("터졌다"));

        new FocusRewardScheduler(details, accruals).accrueDueSessions();

        verify(accruals).accrue(healthy);
    }
}

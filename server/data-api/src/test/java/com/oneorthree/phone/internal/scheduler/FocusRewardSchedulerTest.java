package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusRewardAccrualGate;
import com.oneorthree.phone.internal.service.FocusRewardAccrualService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.annotation.Value;

import java.lang.reflect.Constructor;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 분당 적립 크론의 단계 활성화 (GROMO-1990) — 혼합 버전 배포에서 새 이미지의 크론과 옛 이미지의
 * {@code finish} 가 같은 시간을 서로 다른 멱등 키로 두 번 지급하는 것을 막는 스위치다.
 */
@ExtendWith(MockitoExtension.class)
class FocusRewardSchedulerTest {

    @Mock
    private FocusSessionDetailRepository details;
    @Mock
    private FocusRewardAccrualService accruals;

    @Test
    @DisplayName("게이트가 닫혀 있으면 스캔조차 하지 않는다 — 배포가 수렴하기 전에는 지급 주체가 둘이 된다")
    void aClosedGateSkipsTheWholeTick() {
        new FocusRewardScheduler(details, accruals, new FocusRewardAccrualGate(false)).accrueDueSessions();

        verifyNoInteractions(details, accruals);
    }

    @Test
    @DisplayName("게이트가 열리면 진행 중(ACTIVE) 세션만 훑어 적립한다")
    void anOpenGateAccruesEveryActiveSession() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        given(details.findSessionIdsByLifecycle(FocusSessionLifecycle.ACTIVE))
                .willReturn(List.of(first, second));

        new FocusRewardScheduler(details, accruals, new FocusRewardAccrualGate(true)).accrueDueSessions();

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

        new FocusRewardScheduler(details, accruals, new FocusRewardAccrualGate(true)).accrueDueSessions();

        verify(accruals).accrue(healthy);
    }

    /**
     * 기본값이 사는 곳은 {@code @Value} 표현식 하나뿐이다({@code application-dev|prod.yml} 은 그 값을
     * 환경변수로 미러링할 뿐이다) — 그래서 그 문자열을 직접 고정한다. 기본을 켜짐으로 바꾸면 여기서 깨진다.
     */
    @Test
    @DisplayName("적립 크론은 기본으로 꺼져 있다 — 켜는 것은 배포가 한 버전으로 수렴한 뒤의 운영 결정이다")
    void theAccrualCronIsOffByDefault() throws Exception {
        Constructor<?> constructor = FocusRewardAccrualGate.class.getDeclaredConstructors()[0];
        Value value = constructor.getParameters()[0].getAnnotation(Value.class);

        assertThat(value).isNotNull();
        assertThat(value.value()).isEqualTo("${focus.reward.accrual-enabled:false}");
        assertThat(new FocusRewardAccrualGate(false).isOpen()).isFalse();
    }
}

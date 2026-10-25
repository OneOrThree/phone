package com.oneorthree.phone.focus.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 집중 보상 분당 적립 크론의 활성화 스위치.
 *
 * <p>{@code focus.reward.accrual-enabled}의 기본값은 {@code false}다. 이 설정은 정기 적립만
 * 제어한다. 종료 시에는 마지막 틱 이후 확정된 집중 시간의 보상을 별도로 적립한다.
 */
@Component
public class FocusRewardAccrualGate {

    private final boolean enabled;

    public FocusRewardAccrualGate(@Value("${focus.reward.accrual-enabled:false}") boolean enabled) {
        this.enabled = enabled;
    }

    /**
     * @return 분당 적립 크론이 돌아도 되는가 — 배포 설정 그대로다. 꺼져 있으면 적립은 {@code finish} 가
     *         한 번에 확정한다
     */
    public boolean isOpen() {
        return enabled;
    }
}

package com.oneorthree.phone.focus.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 집중 세션의 신규 시작을 제어하는 배포 설정.
 *
 * <p>{@code focus.session.start-enabled}의 기본값은 {@code false}다. 기존 세션의 휴식·재개·종료는
 * 이 설정과 별개로 처리하며, 시작 서비스는 활성 보상 정책도 확인한다.
 */
@Component
public class FocusSessionStartGate {

    private final boolean enabled;

    public FocusSessionStartGate(@Value("${focus.session.start-enabled:false}") boolean enabled) {
        this.enabled = enabled;
    }

    /**
     * @return 집중 세션 시작 경로가 열려 있는가 — 배포 설정 그대로다
     */
    public boolean isOpen() {
        return enabled;
    }
}

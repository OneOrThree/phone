package com.oneorthree.phone.common.port;

import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * {@link ScreenTimeNotificationPort} 의 자리 채우기 구현 — 아무것도 하지 않는다.
 *
 * <p>포트를 주입받는 쪽이 구현체 부재로 기동에 실패하지 않도록 두는 빈이다. 즉
 * <b>스크린타임 알림은 현재 발송되지 않는다</b>. APNs 구현체를 넣을 때 이 빈은 제거하거나
 * 프로파일로 갈라야 한다 — 남겨 두면 두 구현체가 경합해 어느 쪽이 주입될지 보장되지 않는다.
 */
@Component
public class NoOpScreenTimeNotification implements ScreenTimeNotificationPort {

    @Override
    public void notify(UUID userId, boolean goalAchieved) {
        // TODO: APNs 구현체로 교체
    }
}

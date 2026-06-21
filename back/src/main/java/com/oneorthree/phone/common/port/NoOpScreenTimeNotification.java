package com.oneorthree.phone.common.port;

import org.springframework.stereotype.Component;

@Component
public class NoOpScreenTimeNotification implements ScreenTimeNotificationPort {

    @Override
    public void notify(Long userId, boolean goalAchieved) {
        // TODO: APNs 구현체로 교체
    }
}

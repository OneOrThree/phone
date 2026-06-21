package com.oneorthree.phone.common.port;

import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class NoOpScreenTimeNotification implements ScreenTimeNotificationPort {

    @Override
    public void notify(UUID userId, boolean goalAchieved) {
        // TODO: APNs 구현체로 교체
    }
}

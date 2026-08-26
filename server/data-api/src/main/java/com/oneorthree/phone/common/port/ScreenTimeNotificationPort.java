package com.oneorthree.phone.common.port;

import java.util.UUID;

public interface ScreenTimeNotificationPort {
    void notify(UUID userId, boolean goalAchieved);
}

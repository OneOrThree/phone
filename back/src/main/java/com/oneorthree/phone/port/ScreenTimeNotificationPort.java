package com.oneorthree.phone.port;

import java.util.UUID;

public interface ScreenTimeNotificationPort {
    void notify(UUID userId, boolean goalAchieved);
}

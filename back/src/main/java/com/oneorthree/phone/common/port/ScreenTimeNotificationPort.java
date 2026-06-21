package com.oneorthree.phone.common.port;

public interface ScreenTimeNotificationPort {
    void notify(Long userId, boolean goalAchieved);
}

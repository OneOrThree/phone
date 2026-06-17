package com.oneorthree.phone.port;

public interface ScreenTimeNotificationPort {
    void notify(Long userId, boolean goalAchieved);
}

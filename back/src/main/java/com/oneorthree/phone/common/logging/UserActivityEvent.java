package com.oneorthree.phone.common.logging;

/**
 * USER-ACTIVITY 로그의 이벤트 카탈로그. 각 이벤트는 snake_case 이름과 카테고리를 함께 가진다.
 * 문자열을 흩뿌리지 않고 여기서 한 곳에 관리해 오타·event↔category 불일치를 막는다.
 * 네이밍 컨벤션: object_action 과거형 (event-logging-design.md §2.1, Track 1 GA4와 동일).
 */
public enum UserActivityEvent implements ActivityEvent {

    LOGIN_SUCCEEDED("login_succeeded", "auth"),
    LOGOUT("logout", "auth"),
    USER_SIGNED_UP("user_signed_up", "auth"),
    FOCUS_SESSION_COMPLETED("focus_session_completed", "focus"),
    FOCUS_TAG_CREATED("focus_tag_created", "focus"),
    STREAK_UPDATED("streak_updated", "focus"),
    DAILY_FOCUS_GOAL_ACHIEVED("daily_focus_goal_achieved", "focus"),
    GROUP_JOINED("group_joined", "group"),
    GROUP_LEFT("group_left", "group"),
    INVITE_LINK_CREATED("invite_link_created", "group"),
    LEAGUE_RANK_VIEWED("league_rank_viewed", "league"),
    FRIEND_REQUEST_SENT("friend_request_sent", "friend"),
    FRIEND_ADDED("friend_added", "friend"),
    ITEM_EQUIPPED("item_equipped", "character"),
    GOAL_SET("goal_set", "user"),
    STAT_VISIBILITY_UPDATED("stat_visibility_updated", "user"),
    DAILY_SCREEN_TIME_GOAL_ACHIEVED("daily_screen_time_goal_achieved", "screen_time");

    private final String event;
    private final String category;

    UserActivityEvent(String event, String category) {
        this.event = event;
        this.category = category;
    }

    @Override
    public String event() {
        return event;
    }

    @Override
    public String category() {
        return category;
    }
}

package com.oneorthree.phone.common.logging;

/**
 * USER-ACTIVITY 로그의 이벤트 카탈로그. 각 이벤트는 snake_case 이름과 카테고리를 함께 가진다.
 * 문자열을 흩뿌리지 않고 여기서 한 곳에 관리해 오타·event↔category 불일치를 막는다.
 * 네이밍 컨벤션: object_action 과거형 (event-logging-design.md §2.1, Track 1 GA4와 동일).
 */
public enum UserActivityEvent implements ActivityEvent {

    /** 기존 계정 로그인 성공. 첫 가입은 {@link #USER_SIGNED_UP} 이라 둘이 겹치지 않는다. */
    LOGIN_SUCCEEDED("login_succeeded", "auth"),
    /** 사용자가 명시적으로 로그아웃해 RT 를 무효화한 시점. 토큰 만료는 이 이벤트가 아니다. */
    LOGOUT("logout", "auth"),
    /** 신규 가입 — 게스트 생성과 소셜 첫 로그인 모두 포함한다. */
    USER_SIGNED_UP("user_signed_up", "auth"),
    /** 집중 세션이 정상 완료됐다. 취소·자동종료 세션은 발행하지 않는다. */
    FOCUS_SESSION_COMPLETED("focus_session_completed", "focus"),
    /** 사용자가 집중 태그를 직접 만들었다. 직군 기본 태그 자동 생성은 제외. */
    FOCUS_TAG_CREATED("focus_tag_created", "focus"),
    /** 연속 달성일이 갱신됐다 — 늘어난 경우만이고 끊긴 초기화는 포함하지 않는다. */
    STREAK_UPDATED("streak_updated", "focus"),
    /** 그날 집중 목표 시간에 도달했다. 하루 한 번만 발행된다. */
    DAILY_FOCUS_GOAL_ACHIEVED("daily_focus_goal_achieved", "focus"),
    /** 그룹에 참여했다 — 초대 링크·참가 코드 어느 경로든 같다. */
    GROUP_JOINED("group_joined", "group"),
    /** 그룹에서 나갔다. 방장의 그룹 종료와는 다른 사건이다. */
    GROUP_LEFT("group_left", "group"),
    /** 초대 링크를 발급했다. 링크 클릭·설치 매치는 GA4 쪽 퍼널이 따로 본다. */
    INVITE_LINK_CREATED("invite_link_created", "group"),
    /** 친구 요청을 보냈다. 수락 여부는 {@link #FRIEND_ADDED} 로 갈린다. */
    FRIEND_REQUEST_SENT("friend_request_sent", "friend"),
    /** 친구 관계가 성립했다(요청 수락 시점). 보낸 쪽·받은 쪽 구분은 하지 않는다. */
    FRIEND_ADDED("friend_added", "friend"),
    /** 캐릭터에 아이템을 착용했다. 같은 칸의 기존 아이템 해제는 별도로 발행하지 않는다. */
    ITEM_EQUIPPED("item_equipped", "character"),
    /** 집중·스크린타임 목표치를 설정했다. 달성이 아니라 목표를 정한 시점이다. */
    GOAL_SET("goal_set", "user"),
    /** 통계 공개 범위를 바꿨다(FRIENDS ↔ PUBLIC). */
    STAT_VISIBILITY_UPDATED("stat_visibility_updated", "user"),
    /** 그날 스크린타임 사용 상한을 지켰다. 집중 목표와 달리 "덜 쓰기"가 달성 조건이다. */
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

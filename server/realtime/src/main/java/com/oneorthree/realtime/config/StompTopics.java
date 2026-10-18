package com.oneorthree.realtime.config;

import java.util.UUID;
import java.util.regex.Pattern;

/** 구독과 전달이 공유하는 허용 토픽. 인증·멤버십 판정은 각 인터셉터에서 수행한다. */
public final class StompTopics {

    // 발행 경로의 UUID.toString()과 맞춘다. 대문자 구독은 인가에 성공해도 사건을 받지 못한다.
    static final Pattern GROUP_TOPIC = Pattern.compile("^/topic/groups/([0-9a-f-]{36})$");

    // 구현된 관전·응원 채널과 주민 소식(events, GROMO-2302 — 현재 소속 주민)만 연다. playback·messages는 계속 거절한다.
    static final Pattern ISLAND_TOPIC =
            Pattern.compile("^/topic/islands/([0-9a-f-]{36})/(focus|rest|emotes|events)$");
    static final String EMOTES_CHANNEL = "emotes";
    static final String EVENTS_CHANNEL = "events";

    /**
     * 이동 토픽 둘(GROMO-2247) — {@code group(1)} 은 섬, {@code group(2)} 가 {@code null} 이면 이벤트 토픽
     * ({@code /movement}), {@code "/snapshot"} 이면 스냅샷 토픽이다. 관문·전달 직전 검사·이동 구독 처리가 모두
     * 이 하나를 되읽고, 보내는 쪽은 {@link #movementTopic} 으로 같은 모양을 만든다.
     */
    public static final Pattern MOVEMENT_TOPIC =
            Pattern.compile("^/topic/islands/([0-9a-f-]{36})/movement(/snapshot)?$");

    /** 이동 intent 발신 — {@code MovementStompController} 의 {@code @MessageMapping} 과 같은 모양이다. */
    static final Pattern MOVEMENT_INTENT_SEND =
            Pattern.compile("^/app/islands/([0-9a-f-]{36})/movement/intent$");

    /**
     * 바다 방 토픽(GROMO-2300) — {@code group(1)} 이 방. 관문·전달 직전 검사가 되읽고, 보내는 쪽은
     * {@link #seaRoomTopic} 으로 같은 모양을 만든다.
     */
    public static final Pattern SEA_ROOM_TOPIC = Pattern.compile("^/topic/sea/rooms/([0-9a-f-]{36})$");

    /** 바다 입장·퇴장 발신 — {@code SeaStompController} 의 {@code @MessageMapping} 과 같은 모양이다. */
    static final Pattern SEA_ENTER_SEND = Pattern.compile("^/app/sea/enter$");
    static final Pattern SEA_LEAVE_SEND = Pattern.compile("^/app/sea/leave$");

    /** 방 스냅샷 요청 — 방 토픽 구독 «뒤»에 보낸다(답은 {@link #SEA_QUEUE} 로 {@code sea.room.snapshot}). */
    static final Pattern SEA_SYNC_SEND = Pattern.compile("^/app/sea/sync$");

    /** 바다 방 이모트 발신(컨트롤러는 GROMO-2300 2/2). 관문은 시도 창만 본다. */
    static final Pattern SEA_EMOTE_SEND = Pattern.compile("^/app/sea/rooms/([0-9a-f-]{36})/emotes$");

    /** 배정 결과({@code sea.room.assigned})를 받는 개인 큐 — 구독 목적지 그대로. */
    public static final String SEA_QUEUE = "/user/queue/sea";

    private StompTopics() {
    }

    /** 이동 이벤트 토픽 — {@link #MOVEMENT_TOPIC} 의 스냅샷이 아닌 쪽. */
    public static String movementTopic(UUID islandId) {
        return "/topic/islands/" + islandId + "/movement";
    }

    /** 이동 스냅샷 토픽 — {@link #MOVEMENT_TOPIC} 의 {@code /snapshot} 쪽. */
    public static String movementSnapshotTopic(UUID islandId) {
        return movementTopic(islandId) + "/snapshot";
    }

    /** 바다 방 토픽 — {@link #SEA_ROOM_TOPIC} 과 같은 모양. */
    public static String seaRoomTopic(UUID roomId) {
        return "/topic/sea/rooms/" + roomId;
    }
}

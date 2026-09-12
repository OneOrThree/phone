package com.oneorthree.realtime.event;

import com.fasterxml.jackson.annotation.JsonValue;

/** 14종 이벤트 이름과 정적 채널. 목적지 문자열을 생산자 payload에서 읽지 않는다. */
public enum RealtimeEventType {
    FOCUS_MEMBER_UPDATED("focus.member.updated", "focus"),
    REST_MEMBER_UPDATED("rest.member.updated", "rest"),
    FOCUS_EMOTE("focus.emote", "emotes"),
    PLAYBACK_UPDATED("playback.updated", "playback"),
    MESSAGE_CREATED("message.created", "messages"),
    QUEST_PROGRESS_UPDATED("quest.progress.updated", "events"),
    WALLET_UPDATED("wallet.updated", "events"),
    INVENTORY_UPDATED("inventory.updated", "events"),
    MEMBER_APPEARANCE_UPDATED("member.appearance.updated", "events"),
    ISLAND_APPEARANCE_UPDATED("island.appearance.updated", "events"),
    ISLAND_UPDATED("island.updated", "events"),
    ISLAND_MEMBERS_UPDATED("island.members.updated", "events"),
    NOTICE_UPDATED("notice.updated", "events"),
    JOIN_REQUEST_UPDATED("join.request.updated", "events");

    private final String wireName;
    private final String channel;

    RealtimeEventType(String wireName, String channel) {
        this.wireName = wireName;
        this.channel = channel;
    }

    @JsonValue
    public String wireName() {
        return wireName;
    }

    public String channel() {
        return channel;
    }
}

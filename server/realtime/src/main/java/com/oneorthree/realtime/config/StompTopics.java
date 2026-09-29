package com.oneorthree.realtime.config;

import java.util.regex.Pattern;

/** 구독과 전달이 공유하는 허용 토픽. 인증·멤버십 판정은 각 인터셉터에서 수행한다. */
final class StompTopics {

    // 발행 경로의 UUID.toString()과 맞춘다. 대문자 구독은 인가에 성공해도 사건을 받지 못한다.
    static final Pattern GROUP_TOPIC = Pattern.compile("^/topic/groups/([0-9a-f-]{36})$");

    // 구현된 관전·응원 채널만 연다. events·playback·messages는 계속 거절한다.
    static final Pattern ISLAND_TOPIC =
            Pattern.compile("^/topic/islands/([0-9a-f-]{36})/(focus|rest|emotes)$");
    static final String EMOTES_CHANNEL = "emotes";

    private StompTopics() {
    }
}

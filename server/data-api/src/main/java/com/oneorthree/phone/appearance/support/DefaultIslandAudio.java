package com.oneorthree.phone.appearance.support;

import java.util.List;

/** 모든 섬에 구매 없이 제공하는 기본 음원. 유료 음원과 달리 보유 행을 만들지 않는다. */
public final class DefaultIslandAudio {
    public static final List<String> TRACK_IDS = List.of("waves", "campfire", "forest-wind");

    private DefaultIslandAudio() {
    }

    public static boolean includes(String trackId) {
        return TRACK_IDS.contains(trackId);
    }
}

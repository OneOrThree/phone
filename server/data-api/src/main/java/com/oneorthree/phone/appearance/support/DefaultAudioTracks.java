package com.oneorthree.phone.appearance.support;

import java.util.List;

/** 모든 섬에 구매 없이 제공하는 기본 음원. 카탈로그·미디어 등록은 V129가 담당한다. */
public final class DefaultAudioTracks {
    public static final List<String> IDS = List.of("waves", "campfire", "forest-wind");

    private DefaultAudioTracks() {
    }

    public static boolean contains(String productId) {
        return IDS.contains(productId);
    }
}

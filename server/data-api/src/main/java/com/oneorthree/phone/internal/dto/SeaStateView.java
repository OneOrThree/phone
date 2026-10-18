package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 바다 방 입장 때 realtime 이 한 번 읽는 사용자의 바다 상태 (GROMO-2299, 계약 §2).
 *
 * @param remark          한마디. 없거나 지웠으면 null
 * @param remarkChangedAt 한마디 마지막 변경 시각. 한 번도 안 바꿨으면 null
 * @param session         진행 중인 바다 세션. 없으면 null
 */
public record SeaStateView(String remark, Instant remarkChangedAt, Session session) {

    /**
     * @param sessionId           세션 id
     * @param destinationIslandId 목적지 섬
     * @param sailingMinutes      시작 때 고정한 항해 분
     * @param activeSeconds       {@code serverNow} 시점의 누적 집중 초
     * @param serverNow           이 값을 만든 서버 시각 — {@code activeSeconds} 의 anchor
     * @param startedAt           세션 시작 시각
     */
    public record Session(UUID sessionId, UUID destinationIslandId, int sailingMinutes, long activeSeconds,
                          Instant serverNow, Instant startedAt) {
    }
}

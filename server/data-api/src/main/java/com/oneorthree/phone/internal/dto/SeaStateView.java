package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;

import java.time.Instant;
import java.util.UUID;

/**
 * 바다 방 입장 때 realtime 이 한 번 읽는 사용자의 바다 상태 (GROMO-2299, 계약 §2).
 *
 * @param remark          한마디. 없거나 지웠으면 null
 * @param remarkChangedAt 한마디 마지막 변경 시각. 한 번도 안 바꿨으면 null
 * @param session         진행 중인 바다 세션. 없으면 null
 * @param name            표시 이름(users.nickname). 없으면 null (GROMO-2330)
 * @param catColor        고양이 색 6종 중 하나. 미선택이면 null (GROMO-2330)
 * @param appearance      착용 외양(GROMO-2389) — realtime 은 head·neck 만 방 구성원 표시에 쓴다
 */
public record SeaStateView(String remark, Instant remarkChangedAt, Session session, String name, String catColor,
                           PersonalAppearanceView appearance) {

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

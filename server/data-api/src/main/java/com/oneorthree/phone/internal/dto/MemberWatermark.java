package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 주민 투영 한 key 의 스냅샷 버전 (GROMO-1765, realtime-events LLD §5.1).
 *
 * <p>{@code version} 은 그 key 로 outbox 가 마지막으로 발급한 aggregate version 이다 — 목록 행과
 * <b>같은 DB 스냅샷</b>에서 읽는다. 앱은 같은 {@code (projection, islandId, aggregateId)} 의
 * {@code version > watermark} 사건만 적용한다. 아직 사건이 한 번도 발급되지 않은 key 는 0 이다.
 *
 * @param projection  {@code "focus.member"} 또는 {@code "rest.member"} — 두 축은 서로 비교하지 않는다
 * @param islandId    섬
 * @param aggregateId 주민 userId
 * @param version     마지막 발급 version(없으면 0)
 */
public record MemberWatermark(String projection, UUID islandId, UUID aggregateId, long version) {

    public static final String FOCUS_MEMBER = "focus.member";
    public static final String REST_MEMBER = "rest.member";
}

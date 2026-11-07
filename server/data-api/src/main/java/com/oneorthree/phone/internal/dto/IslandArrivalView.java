package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.UUID;

/**
 * {@code POST /internal/users/{userId}/islands/{islandId}/arrivals} 응답 (GROMO-2260, 섬 외부 계약 §1).
 *
 * @param arrivedBefore    주민이면 «현 가입 이후 주민으로서 이미 와 본 적이 있었다» — false 면 이번이 첫 도착이라 앱이
 *                         「환영해요」를 띄우고 그 섬 주민에게 {@code island.member.arrived} 가 나간다(GROMO-2302).
 *                         방문자는 언제나 true(이 호출이 기록을 남겼다)
 * @param membershipStatus {@code active|pending|none} — 본인 기준
 * @param currentIslandId  도착 처리 뒤 현재 섬. 주민이면 도착한 섬, 방문자면 그대로(없으면 null)
 * @param firstArrivalEventId 이 호출이 계정의 첫 도착 사건({@code first_island_arrivals})을 만들었을 때만 채우는 Meta 이벤트 ID.
 *                         앱 SDK 로그와 서버 CAPI 가 같은 event_id 로 중복 제거된다(GROMO-2748). 그 외에는 키 자체를 내리지 않는다
 */
public record IslandArrivalView(UUID islandId, boolean arrivedBefore, String membershipStatus,
        UUID currentIslandId, @JsonInclude(JsonInclude.Include.NON_NULL) UUID firstArrivalEventId) {

    public IslandArrivalView withFirstArrivalEventId(UUID eventId) {
        return new IslandArrivalView(islandId, arrivedBefore, membershipStatus, currentIslandId, eventId);
    }
}

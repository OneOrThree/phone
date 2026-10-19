package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * {@code DELETE /islands/{islandId}/memberships/me} 결과 (GROMO-1802, 섬 관리 LLD §3.7). 성공이 원 실행 권한을
 * 없애는 명령이라, 같은 키 재생은 활성 사용자 본인에게 이 최소 증거만 돌려준다(LLD §4).
 *
 * @param nextLocation 나간 사람의 다음 위치 (GROMO-2260). 내부 경로가 {@code include=nextLocation} 으로 요청할
 *     때만 싣는다 — 없으면 null 이라 키째 빠지고 응답은 GROMO-2260 이전과 같은 {@code {"left":true}} 다
 *     (구 Business 는 키가 정확히 하나인 응답만 받는다). 배포 전 receipt 의 재생도 null 이다
 */
public record IslandLeftView(boolean left,
        @JsonInclude(JsonInclude.Include.NON_NULL) NextLocationView nextLocation) {
}

package com.oneorthree.phone.group.repository;

import java.util.UUID;

/**
 * 「이 사용자의 섬 하나」 — 이름까지 함께 뜨는 배치 조회용 (GROMO-1971).
 *
 * <p>친구 목록은 상대의 메인 섬 <b>이름</b>을 내려보내는데, 상대마다 섬을 따로 조회하면 그대로 N+1 이다
 * (티어·집중 라이브가 이미 배치인 것과 같은 이유). 엔티티를 전량 로드하지 않고 세 값만 가져온다.
 *
 * @param userId   주인
 * @param islandId 섬 id
 * @param name     섬 이름
 */
public record UserIslandNameProjection(UUID userId, UUID islandId, String name) {
}

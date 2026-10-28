package com.oneorthree.phone.friend.service.search;

import java.util.List;
import java.util.UUID;

/**
 * 친구 검색 전략 (설계 §4 — SocialLoginClient 다형성 패턴 재사용).
 * Spring이 모든 구현체 빈을 모아 type() 기준 Map으로 구성 → 검색 수단 추가 = 구현체 1개 추가.
 */
public interface FriendSearchStrategy {

    /**
     * 구현체가 담당하는 검색 수단 (NICKNAME, 후속 CODE)
     *
     * @return 이 구현체가 등록될 Map 키. 값이 겹치면 한쪽 전략이 조용히 덮이므로 구현체마다 달라야 한다
     */
    SearchType type();

    /**
     * 전략 단계 원시 결과 반환. me는 자기자신 제외용,
     * relation(기존 관계) 표기는 FriendService가 후처리한다.
     *
     * @param me    검색을 건 유저 — 결과에서 빼야 할 대상
     * @param query 검색어. 해석 방식은 전략마다 다르다
     * @return relation 이 아직 비어 있는 원시 결과. 결과 수 상한도 전략이 정한다
     */
    List<FriendSearchResult> search(UUID me, String query);
}

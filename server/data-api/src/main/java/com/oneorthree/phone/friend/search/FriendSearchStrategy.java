package com.oneorthree.phone.friend.search;

import java.util.List;
import java.util.UUID;

/**
 * 친구 검색 전략 (설계 §4 — SocialLoginClient 다형성 패턴 재사용).
 * Spring이 모든 구현체 빈을 모아 type() 기준 Map으로 구성 → 검색 수단 추가 = 구현체 1개 추가.
 */
public interface FriendSearchStrategy {

    /**
     * 구현체가 담당하는 검색 수단 (NICKNAME, 후속 CODE)
     */
    SearchType type();

    /**
     * 전략 단계 원시 결과 반환. me는 자기자신 제외용,
     * relation(기존 관계) 표기는 FriendService가 후처리한다.
     */
    List<FriendSearchResult> search(UUID me, String query);
}

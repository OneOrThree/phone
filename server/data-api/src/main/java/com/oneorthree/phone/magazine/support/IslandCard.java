package com.oneorthree.phone.magazine.support;

import java.util.UUID;

/**
 * 잡지에 실리는 섬 한 곳의 숫자 — 발행 순간(07:00 KST) 고정한 값이다(정본 137행 「그 호에 고정」). 홍보 칸의
 * {@code island_promotions.snapshot} 과 편집부 페이지({@code magazine_issues.editorial})가 같은 모양을 쓴다.
 *
 * <p>섬 그림 단계는 저장하지 않고 완공 건물 수만 적는다 — 단계 규칙은 그림을 가진 앱이 정한다(계획 P8).
 *
 * @param averageFocusMinutesPerDay 최근 7일 주민 1명당 하루 평균 집중(분). 주민이 0명이거나 아직 집계 전이면 null
 */
public record IslandCard(UUID islandId, String name, int buildingCount, int memberCount, int maxMembers,
                         Integer averageFocusMinutesPerDay) {
}

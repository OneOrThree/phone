package com.oneorthree.phone.focus.repository;

import java.util.UUID;

/**
 * 상세 행의 주인·섬만 읽는 프로젝션 — JPQL 생성자 표현식의 결과 타입 (GROMO-1924).
 *
 * <p><b>엔티티가 아니라서 존재한다.</b> 전이는 섬·멤버십을 «먼저» 잠근 뒤 상세를 잠가야 하는데(LLD §3),
 * 어느 섬을 잠글지 알려면 상세를 먼저 읽어야 한다. 그 읽기를 엔티티로 하면 영속성 컨텍스트에 잠금
 * «이전» 상태가 올라가고, 뒤이은 {@code SELECT … FOR UPDATE} 는 이미 관리 중인 그 인스턴스를 돌려준다 —
 * 잠금을 기다리는 동안 커밋된 다른 전이의 lifecycle·version 을 못 보고 낡은 값으로 판정한다. 스칼라
 * 프로젝션은 컨텍스트에 올라가지 않는다. 이 클래스의 FQCN 은 {@code @Query} 문자열 안에도 있다.
 *
 * @param userId   세션 주인 — 탈퇴 익명화로 null 일 수 있다
 * @param islandId 시작 때 고정된 섬(FR-P03, 불변)
 */
public record FocusSessionOwnership(UUID userId, UUID islandId) {
}

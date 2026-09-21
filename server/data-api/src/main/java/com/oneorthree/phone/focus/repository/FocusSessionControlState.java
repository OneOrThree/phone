package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;

import java.util.UUID;

/**
 * 프레즌스 재구축이 정본에서 읽는 <b>절대 상태와 전이 번호</b> — JPQL 생성자 표현식의 결과 타입 (GROMO-2003).
 *
 * <p><b>왜 필요한가.</b> 리컨실러는 진행 중 <b>기본 마커</b>({@code focus_sessions})를 훑는데, 리스 값이
 * {@code active}/{@code paused} 를 구분하게 되면서 마커만으로는 쓸 값을 정할 수 없게 됐다. 휴식 중인
 * 세션의 리스를 {@code active} 로 되살리면 그 값은 정본과 어긋난 채 세션이 끝날 때까지 남는다.
 * v0.3 상세({@code focus_session_details})가 그 두 값을 들고 있으므로 한 번의 IN 조회로 함께 읽는다.
 *
 * <p>엔티티가 아니라 프로젝션인 이유는 {@link FocusSessionOwnership} 과 같다 — 리컨실러의 읽기
 * 트랜잭션은 «닫힌 뒤» 쓰기가 일어나는 구조라, 영속성 컨텍스트에 상세 인스턴스를 올릴 이유가 없다.
 *
 * <p>레거시 마커는 상세가 없어 이 행이 아예 없다 — 부르는 쪽이 「없으면 active·전이 번호 0」으로 본다.
 *
 * @param sessionId 기본 마커와 같은 id
 * @param lifecycle 지금의 lifecycle — {@code PAUSED} 만 휴식이다
 * @param version   그 세션 안의 전이 번호(controlVersion)
 */
public record FocusSessionControlState(UUID sessionId, FocusSessionLifecycle lifecycle, long version) {
}

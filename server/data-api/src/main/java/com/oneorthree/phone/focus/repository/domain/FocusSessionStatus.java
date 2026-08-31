package com.oneorthree.phone.focus.repository.domain;

/**
 * 집중 세션 상태값. varchar + CHECK 제약(V2)으로 저장되며 {@code @Enumerated(STRING)} 매핑.
 */
public enum FocusSessionStatus {
    /**
     * 진행 중(라이브). 종료 시각(endedAt)이 채워지면 완료 전이로 COMPLETED 가 된다.
     * (GROMO-610 시절 레거시 경로로 endedAt 만 채워지고 ACTIVE 로 남은 완료 세션도 존재할 수 있어,
     * 완료 조회 필터는 status=COMPLETED 단독이 아닌 NOT IN(CANCELED, AUTO_CLOSED) 방식을 유지한다.)
     */
    ACTIVE,
    /**
     * 정상 완료(GROMO-733부터 사용). 세션 완료 전이({@link FocusSession#end}) 및 POST 완료 저장
     * ({@code FocusService.saveFocusSession})이 이 값을 세팅한다. 통계·스트릭에 반영되는 정상값이며,
     * 완료 조회 필터 NOT IN(CANCELED, AUTO_CLOSED)를 통과한다.
     */
    COMPLETED,
    CANCELED,
    /**
     * orphan 자동 종료(GROMO-804). 앱 강제종료 등으로 미종료로 남은 세션을 스케줄러가 '시작+상한'으로 종료할 때
     * 부여한다. 종료 시각 신뢰도가 낮아(유저 미확정) <b>통계·스트릭에 미반영</b>하며, by-category 실시간 집계에서도
     * 제외된다({@code FocusSessionRepository.findCompletedSessionsOverlappingPeriod}) — 사전집계 {@code /stats/focus} 와 총합 정합.
     */
    AUTO_CLOSED
}

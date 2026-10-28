package com.oneorthree.phone.focus.repository.domain;

/**
 * 집중 세션 상태값. varchar + CHECK 제약(V2)으로 저장되며 {@code @Enumerated(STRING)} 매핑.
 */
public enum FocusSessionStatus {
    /**
     * 진행 중. 정상 종료하면 {@link FocusSession#end}가 COMPLETED로 바꾼다.
     * 이전 기록에는 종료 시각만 채워진 ACTIVE 행이 있을 수 있으므로 조회 시 종료 시각도 확인한다.
     */
    ACTIVE,
    /**
     * 정상 완료. {@link FocusSession#end}가 종료 시각과 확정된 집중 시간을 기록하며 설정한다.
     */
    COMPLETED,
    /**
     * 사용자가 직접 취소했다. 통계·스트릭에 반영하지 않으며 완료 조회 필터에서도 제외된다.
     * 자동 종료({@code AUTO_CLOSED})와 달리 사용자의 의사가 분명한 종료다.
     */
    CANCELED,
    /**
     * 정상 완료로 집계하지 않는 기본 세션의 강제 종료 상태.
     */
    AUTO_CLOSED
}

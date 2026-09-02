package com.oneorthree.phone.focus.repository.domain;

/**
 * 집중 세션의 진행 방식. 세션이 어떻게 끝나는지가 달라질 뿐 통계·보상 계산은 셋 다 같다.
 * 값이 없으면(구버전 앱) {@code INFINITE} 로 떨어진다.
 */
public enum FocusType {
    /** 무한 — 사용자가 멈출 때까지 계속 간다. 값이 없는 구버전 앱도 여기로 떨어진다. */
    INFINITE,
    /** 구간 — 정해둔 목표 시간에 도달하면 끝난다. */
    RANGE,
    /** 뽀모도로 — 집중과 휴식을 번갈아 반복한다. */
    POMODORO
}

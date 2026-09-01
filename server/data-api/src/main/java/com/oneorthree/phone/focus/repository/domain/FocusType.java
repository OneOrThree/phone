package com.oneorthree.phone.focus.repository.domain;

/**
 * 집중 세션의 진행 방식. 세션이 어떻게 끝나는지가 달라질 뿐 통계·보상 계산은 셋 다 같다.
 * 값이 없으면(구버전 앱) {@code INFINITE} 로 떨어진다.
 */
public enum FocusType {
    INFINITE,
    RANGE,
    POMODORO
}

package com.oneorthree.phone.focus.repository.domain;

/**
 * 집중 세션의 종류 (GROMO-2299, 바다 항해 계약 §1). 섬 세션은 소속 섬에서, 바다 세션은 멤버십 없이 목적지 섬을 향해
 * 항해하며 한다. {@code focus_session_details.kind} 에 이름 그대로 저장한다.
 */
public enum FocusSessionKind {
    ISLAND,
    SEA
}

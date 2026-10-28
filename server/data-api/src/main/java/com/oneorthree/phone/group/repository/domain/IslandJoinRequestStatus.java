package com.oneorthree.phone.group.repository.domain;

/**
 * 가입 요청의 상태 (LLD §4 JoinRequest).
 *
 * <p>{@code PENDING} 이 유일한 열린 상태이고 나머지 셋은 전부 종결이다. 종결된 요청은 다시 열리지
 * 않는다 — 재신청은 새 요청(새 requestId)이다.
 */
public enum IslandJoinRequestStatus {
    PENDING,
    APPROVED,
    REJECTED,
    CANCELLED;

    /** 공개 wire 이름 — 응답·이벤트에는 소문자 상태가 나간다. */
    public String wireName() {
        return name().toLowerCase(java.util.Locale.ROOT);
    }
}

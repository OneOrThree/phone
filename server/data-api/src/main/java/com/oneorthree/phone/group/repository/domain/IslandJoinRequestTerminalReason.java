package com.oneorthree.phone.group.repository.domain;

/**
 * 가입 요청을 닫은 내부 사유 (LLD §4 {@code terminal_reason}).
 *
 * <p>공개 status 만으로는 「방장이 거절한 것」과 「신청자가 철회한 것」이 전부
 * {@code cancelled}/{@code rejected} 계열로 뭉뚱그려진다. 이 값은 응답에 나가지 않고
 * 조회·감사에서 정합한 해석을 위해 저장한다.
 */
public enum IslandJoinRequestTerminalReason {
    /** 신청자 본인이 철회했다 — 공개 status {@code cancelled}. */
    APPLICANT_CANCELLED,
    /** 방장이 승인했다 — 공개 status {@code approved}. */
    HOST_APPROVED,
    /** 방장이 거절했다 — 공개 status {@code rejected}. */
    HOST_REJECTED,
    /** 섬이 종결돼 열려 있던 요청이 함께 닫혔다 — 공개 status {@code cancelled}. */
    ISLAND_CLOSED;
}

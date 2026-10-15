package com.oneorthree.phone.invitelink.repository.domain;

/**
 * 클릭 이관 한 회차의 상태 (서비스 §7.2 · A22 ㋮).
 *
 * <p>두 값 사이가 「구 후보를 읽을 수 있는 구간」이다. {@code IMPORT_CLOSED} 이후에는 importer 가
 * 쓰지 못하고, 그때서야 신 직접 쓰기를 연다 — 늦은 백필이 이미 소진된 상태를 덮는 것을 막는다.
 */
public enum InviteClickMigrationStatus {

    /** 정지 스냅샷 확정 — read-only export 가 가능하다. */
    FROZEN,

    /** importer 쓰기 차단 — 신 직접 쓰기 개방 직전 단계다. */
    IMPORT_CLOSED
}

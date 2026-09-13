package com.oneorthree.phone.invitelink.repository.domain;

/**
 * claim 의도의 처리 상태 (A22 ㊄ · ㊺).
 *
 * <p>세 값이 서로 다른 사실을 담는다. 「소비됨」과 「더 밟을 것이 없음」을 한 값으로 합치면
 * 재개 스캔이 정본 판정으로 끝난 의도를 영원히 다시 집는다.
 */
public enum InviteClaimIntentStatus {

    /** 아직 확정되지 않았다 — 재개 대상이다. */
    PENDING,

    /** 확정까지 끝났다. */
    CONSUMED,

    /** 정본 판정(없는 slug·폐기된 링크 등)으로 더 밟을 것이 없다. 실패가 아니라 종결이다. */
    ABANDONED
}

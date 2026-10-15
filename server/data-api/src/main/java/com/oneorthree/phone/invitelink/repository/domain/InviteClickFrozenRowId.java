package com.oneorthree.phone.invitelink.repository.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * {@link InviteClickFrozenRow} 의 복합 키 — {@code (migrationId, clickId)}.
 *
 * <p>회차별로 같은 클릭이 다시 담길 수 있어야 한다(리허설 → 본 이관). 그래서 클릭 PK 단독이 아니라
 * 회차를 앞에 둔다 — ㋮ 의 {@code compat_applied} 표시가 같은 모양의 키를 쓰는 것과 같은 이유다.
 *
 * @param migrationId 이관 회차
 * @param clickId     구 {@code invite_link_clicks} 의 PK
 */
public record InviteClickFrozenRowId(String migrationId, UUID clickId) implements Serializable {

    private static final long serialVersionUID = 1L;

    public InviteClickFrozenRowId {
        Objects.requireNonNull(migrationId, "migrationId");
        Objects.requireNonNull(clickId, "clickId");
    }
}

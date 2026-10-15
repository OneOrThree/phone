package com.oneorthree.phone.invitelink.repository.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * {@link InviteLinkFrozenRow} 의 복합 키 — {@code (migrationId, linkId)}.
 *
 * @param migrationId 이관 회차
 * @param linkId      구 {@code group_invite_links} 의 PK
 */
public record InviteLinkFrozenRowId(String migrationId, UUID linkId) implements Serializable {

    private static final long serialVersionUID = 1L;

    public InviteLinkFrozenRowId {
        Objects.requireNonNull(migrationId, "migrationId");
        Objects.requireNonNull(linkId, "linkId");
    }
}

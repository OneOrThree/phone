package com.oneorthree.phone.magazine.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/**
 * 계정당 1부의 받음·나중에·읽음 상태 (GROMO-2289, V120, MAG-02·03). 행은 리포지토리의 {@code insertIfAbsent} 로만 생긴다 —
 * 받은 곳·받은 시각은 처음 값으로 고정되고, 나중에·읽음 시각은 처음 한 번만 적힌다(되돌리지 않는다).
 */
@Entity
@Table(name = "magazine_receipts")
@IdClass(MagazineReceipt.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MagazineReceipt {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Column(name = "issue_id")
    private UUID issueId;

    /** {@code SEA} · {@code ISLAND}. */
    @Column(name = "received_place", nullable = false, length = 10, updatable = false)
    private String receivedPlace;

    @Column(name = "received_at", nullable = false, updatable = false)
    private Instant receivedAt;

    /** [나중에 읽기] 를 처음 누른 시각. */
    @Column(name = "deferred_at")
    private Instant deferredAt;

    /** 처음 펼친 시각 — null 이면 안 읽음(빨간 점). */
    @Column(name = "opened_at")
    private Instant openedAt;

    public void markDeferred(Instant now) {
        if (deferredAt == null) {
            deferredAt = now;
        }
    }

    public void markOpened(Instant now) {
        if (openedAt == null) {
            openedAt = now;
        }
    }

    /** 복합 키 — {@code (user_id, issue_id)}. */
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private UUID userId;
        private UUID issueId;
    }
}

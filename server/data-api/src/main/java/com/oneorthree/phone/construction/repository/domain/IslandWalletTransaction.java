package com.oneorthree.phone.construction.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 공동 원장 한 줄 — {@code currency_transactions} 의 섬 축 대응물이다.
 * {@code amount} 는 항상 양수로 적고 방향은 {@code type} 이 표현한다.
 * {@code idempotencyKey} 는 유니크 제약이 걸린 중복 기입의 최후 방어선이다.
 */
@Entity
@Table(name = "island_wallet_transactions", uniqueConstraints = @UniqueConstraint(
        name = "uq_island_wallet_tx_idem",
        columnNames = {"island_id", "type", "idempotency_key"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandWalletTransaction {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Column(nullable = false)
    private int amount;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 40)
    private IslandWalletTransactionType type;

    @Column(name = "idempotency_key", length = 200)
    private String idempotencyKey;

    @CreationTimestamp
    @Column(name = "created_at")
    private Instant createdAt;
}

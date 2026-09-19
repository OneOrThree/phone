package com.oneorthree.phone.quest.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * 회차 정산 한 건 (GROMO-1773, LLD §3 Claim) — 도메인 유일 (섬, 회차, kind). 요청 키 멱등과
 * 별개로, 두 주민이 서로 다른 키로 동시에 받아도 이 유일키가 지급을 한 번으로 묶는다(Q06).
 *
 * <p>보상은 전부 섬 통장으로 간다(2026-09-19 결정 Q-1) — {@code walletIdempotencyKey} 는 그 원장
 * 기입({@code QUEST_SETTLEMENT})을 가리킨다.
 */
@Entity
@Table(name = "island_quest_claims", uniqueConstraints = @UniqueConstraint(
        name = "uq_island_quest_claim", columnNames = {"island_id", "occurrence_id", "kind"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandQuestClaim {

    /** 섬 단위 정산 한 종류뿐이다 — 개인 지급 kind 는 결정 Q-1 로 없다. */
    public static final String KIND_SETTLEMENT = "SETTLEMENT";

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Column(name = "occurrence_id", nullable = false)
    private UUID occurrenceId;

    @Column(nullable = false, length = 20)
    private String kind;

    @Column(nullable = false)
    private int amount;

    /** 수령을 누른 주민 — 누가 눌렀든 적립처는 섬 통장이다. */
    @Column(name = "claimed_by", nullable = false)
    private UUID claimedBy;

    @Column(name = "wallet_idempotency_key", nullable = false, length = 200)
    private String walletIdempotencyKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

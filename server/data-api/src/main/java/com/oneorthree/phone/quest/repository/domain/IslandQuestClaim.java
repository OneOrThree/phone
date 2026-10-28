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
 * 회차 정산 한 건 (GROMO-1773, LLD §3 Claim) — 도메인 유일 (섬, 회차, kind, 수령자). 요청 키 멱등과
 * 별개로, 같은 주민이 다른 키로 두 번 눌러도 이 유일키가 지급을 한 번으로 묶는다(Q06).
 *
 * <p>종류가 둘이다(GROMO-1991, 기획 정본 「일일 퀘스트와 보상」): 주민이 «받기»를 눌러 받는
 * {@link #KIND_ACHIEVER}(회차 × 주민 1행)와, 전원 달성 순간 수령 없이 적립되는
 * {@link #KIND_ALL_ACHIEVED_BONUS}(회차 1행, 누른 사람이 없어 {@code claimedBy} 가 null).
 *
 * <p>보상은 전부 섬 통장으로 간다(2026-09-19 결정 Q-1) — {@code walletIdempotencyKey} 는 그 원장
 * 기입({@code QUEST_SETTLEMENT})을 가리킨다.
 */
@Entity
@Table(name = "island_quest_claims", uniqueConstraints = @UniqueConstraint(
        name = "uq_island_quest_claim",
        columnNames = {"island_id", "occurrence_id", "kind", "claimed_by"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandQuestClaim {

    /** 개인 달성분 — 「본인이 받기를 누르면 섬에 물고기 10마리」(기획 정본). 회차 × 주민 1행. */
    public static final String KIND_ACHIEVER = "ACHIEVER";

    /** 전원 달성 보너스 — 「전원 달성 시 대상 주민 수 × 5마리를 즉시 지급」(기획 정본). 회차 1행. */
    public static final String KIND_ALL_ACHIEVED_BONUS = "ALL_ACHIEVED_BONUS";

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

    /**
     * 수령을 누른 주민 — 누가 눌렀든 적립처는 섬 통장이다. 그 주민이 계정을 탈퇴하면 null(GROMO-1950).
     * 전원 달성 보너스 행은 수령 행위가 없어 처음부터 null 이다(GROMO-1991).
     */
    @Column(name = "claimed_by")
    private UUID claimedBy;

    @Column(name = "wallet_idempotency_key", nullable = false, length = 200)
    private String walletIdempotencyKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

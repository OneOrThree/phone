package com.oneorthree.phone.focus.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 세션당 정산 결과 1건 (V58 {@code focus_settlements}, GROMO-1924 에서 처음 쓴다). PK 가 세션 id 라 한 세션은
 * 두 번 정산되지 않고, 다른 멱등 키로 온 완료 재요청은 이 행을 그대로 돌려준다(LLD §2 finish).
 *
 * <p>보존식 {@code earnedFish = personalFishAdded + constructionFishAdded}(E=P+C, LLD §3). 이름의
 * {@code construction} 은 V58 의 열 이름이고 실제로는 섬 통장 몫이다(D1).
 *
 * <p>{@code quest_progress}·{@code events} 열은 매핑하지 않는다 — 퀘스트 계약(1772/1773)이 아직 없어 쓸
 * 값이 없고, 사건은 outbox 가 정본이다.
 */
@Entity
@Table(name = "focus_settlements")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSettlement {

    @Id
    @Column(name = "session_id")
    private UUID sessionId;

    @Column(name = "contract_version", nullable = false)
    @Builder.Default
    private int contractVersion = 1;

    @Column(name = "policy_revision")
    private Integer policyRevision;

    @Column(name = "active_seconds", nullable = false)
    private long activeSeconds;

    @Column(name = "goal_achieved", nullable = false)
    private boolean goalAchieved;

    @Column(name = "earned_fish", nullable = false)
    private int earnedFish;

    @Column(name = "personal_fish_added", nullable = false)
    private int personalFishAdded;

    @Column(name = "construction_fish_added", nullable = false)
    private int constructionFishAdded;

    @Column(name = "completed_at", nullable = false)
    private Instant completedAt;

    @CreationTimestamp
    @Column(name = "created_at", columnDefinition = "timestamptz not null default now()")
    private Instant createdAt;
}

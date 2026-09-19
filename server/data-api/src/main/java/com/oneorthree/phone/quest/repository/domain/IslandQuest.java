package com.oneorthree.phone.quest.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

/**
 * 섬 퀘스트 정의 (GROMO-1773, LLD §3 QuestDefinition) — 방장만 만들고 고친다(D3).
 *
 * <p>정의는 «다음 회차의 틀»이다. 열린 회차는 여는 순간 이 행의 값을 스냅샷으로 복사하므로
 * PATCH 는 진행 중인 회차를 바꾸지 않고 다음 회차부터 적용된다(2026-09-19 결정 Q-4, QQ02).
 * {@code revision} 은 정의가 바뀔 때마다 오르고, 회차가 어느 정의에서 나왔는지 가리킨다.
 *
 * <p>창 시각({@code windowStart}·{@code windowEnd})은 UTC 벽시계다(결정 Q-6). focus 만 갖고
 * screen 은 null — DB CHECK 가 같은 규칙을 상주 감시한다.
 */
@Entity
@Table(name = "island_quests")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandQuest {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private QuestType type;

    @Column(nullable = false, length = 40)
    private String title;

    @Column(name = "target_minutes", nullable = false)
    private int targetMinutes;

    @Column(name = "window_start")
    private LocalTime windowStart;

    @Column(name = "window_end")
    private LocalTime windowEnd;

    @Column(nullable = false)
    @Builder.Default
    private int revision = 1;

    /** 만든 방장 — 스케줄러가 여는 회차 사건의 주체로 쓴다(시스템 주체가 따로 없다). */
    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** 정의 수정 — 넘긴 값만 바꾸고 revision 을 올린다. 열린 회차는 자기 스냅샷을 쓴다. */
    public void revise(String newTitle, Integer newTargetMinutes) {
        if (newTitle != null) {
            this.title = newTitle;
        }
        if (newTargetMinutes != null) {
            this.targetMinutes = newTargetMinutes;
        }
        this.revision = this.revision + 1;
    }
}

package com.oneorthree.phone.league.repository.domain;

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
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 한 주차의 경쟁 단위. {@code startedAt}(KST 월요일 00:00)에 유니크 제약이 걸려 있어, 주차당 아레나는
 * 하나뿐이고 그 행의 존재 자체가 "이 주차 배치가 돌았다"는 가드가 된다.
 */
@Entity
@Table(
        name = "league_arenas",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_league_arenas_started_at",
                columnNames = "started_at")
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LeagueArena {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private LeagueArenaStatus status = LeagueArenaStatus.ACTIVE;

    @Column(name = "ended_at")
    private Instant endedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    /**
     * 주간 마감 — 아레나를 ENDED 로 전환하고 마감 시각을 기록한다
     *
     * @param endedAt 마감 시각. 이미 ENDED 면 이 값은 무시되고 최초 마감 시각이 그대로 남는다 —
     *                배치 재실행이 마감 시각을 밀지 않게 하려는 것이다
     */
    public void end(Instant endedAt) {
        // 이미 ENDED 상태이면 배치 멱등성 재실행 경로를 위해 조용히 무시한다
        if (this.status == LeagueArenaStatus.ENDED) {
            return;
        }
        this.status = LeagueArenaStatus.ENDED;
        this.endedAt = endedAt;
    }
}

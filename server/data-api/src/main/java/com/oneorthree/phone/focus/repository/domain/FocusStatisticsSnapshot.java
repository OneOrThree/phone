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

import java.time.Instant;
import java.util.UUID;

/**
 * 회관 집중 기록 scope=me 의 조회 스냅샷 (GROMO-1769, LLD §3) — 첫 페이지가 계산한 합계·일별·기록 전체를 고정해
 * 다음 페이지가 같은 시점의 표를 읽게 한다. {@code asOf} 만 남기고 현재 DB 로 페이지를 다시 만들지 않는다.
 *
 * <p>요청자 본인의 기록만 담는다. id 는 추측할 수 없는 무작위 UUID 이고, 조회는 늘 {@code userId} 와 함께 한다.
 */
@Entity
@Table(name = "focus_statistics_snapshots")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusStatisticsSnapshot {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** 고정한 결과 JSON — 서비스만 읽고 쓴다. */
    @Column(nullable = false, columnDefinition = "text")
    private String payload;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false,
            columnDefinition = "timestamptz not null default now()")
    private Instant createdAt;
}

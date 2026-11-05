package com.oneorthree.phone.group.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 계정의 «첫 섬 도착» 사건과 Meta Conversions API 전송 상태 (GROMO-2741, V10).
 *
 * <p>쓰기는 {@code FirstIslandArrivalRepository} 의 네이티브 쿼리뿐이다 — 이 매핑은 스키마 선언과 읽기용이다
 * (Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 테이블이 있어야 한다).
 * 상태는 PENDING → SENT|FAILED|EXPIRED 이고 메타 값이 없으면 처음부터 SKIPPED 다.
 */
@Entity
@Table(name = "first_island_arrivals")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FirstIslandArrival {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "event_id", nullable = false, unique = true)
    private UUID eventId;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(name = "anon_id", length = 128)
    private String anonId;

    @Column(name = "advertiser_tracking_enabled")
    private Boolean advertiserTrackingEnabled;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extinfo", columnDefinition = "jsonb")
    private List<String> extinfo;

    @Column(name = "client_ip", length = 45)
    private String clientIp;

    @Column(name = "send_status", nullable = false, length = 16)
    private String sendStatus;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "last_error", length = 200)
    private String lastError;
}

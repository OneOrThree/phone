package com.oneorthree.realtime.tombstone;

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
 * 탈퇴 사용자 tombstone (GROMO-1946 · 계정 LLD §4) — 「이 사용자는 탈퇴했다」의 로컬 사실.
 *
 * <p>행은 Data 의 {@code user.withdrawn} 소비자({@code ChatUserFence#withdraw}, GROMO-1943)가 JDBC UPSERT 로
 * 만든다 — 이 엔티티는 조회 전용이다. 스키마는 V2 가 정본이다. PK 가 Data 의 사용자 UUID 라 UUID v7 생성기를 쓰지
 * 않는다. 다른 사용자 정보는 싣지 않는다 — tombstone 이 새 개인정보 사본이 되면 안 된다.
 */
@Entity
@Getter
@Builder
@Table(name = "user_tombstones")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserTombstone {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /** 탈퇴로 올린 뒤의 인증 세대. */
    @Column(name = "auth_generation", nullable = false)
    private long authGeneration;

    @Column(name = "withdrawn_at", nullable = false)
    private Instant withdrawnAt;
}

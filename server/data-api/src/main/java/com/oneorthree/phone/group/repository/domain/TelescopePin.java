package com.oneorthree.phone.group.repository.domain;

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
 * 망원경 핀 — 이 사람이 잡지·전망대로 «직접 넣은 섬» (GROMO-2268, V115, 섬 외부 계약 §6).
 *
 * <p>쓰기는 {@code TelescopePinRepository.insertIfAbsent} 의 네이티브 INSERT 하나다 — 이 매핑은 스키마 선언과
 * 읽기용이다(Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 테이블이 있어야 한다). 한 번 만든 행은 바뀌지
 * 않는다: 이미 있는 핀을 다시 넣어도 출처·넣은 시각을 갱신하지 않고, 만료된 행은 지우고 새로 넣는다.
 */
@Entity
@Table(name = "telescope_pins")
@IdClass(TelescopePin.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TelescopePin {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    /** {@code magazine|observatory} — 표의 CHECK 와 같다. */
    @Column(nullable = false, length = 20)
    private String source;

    /** 넣은 시각 — 5번째를 넣을 때 가장 오래된 핀을 고르는 축이다. */
    @Column(name = "pinned_at", nullable = false)
    private Instant pinnedAt;

    /** 다음 07:00 KST — 이 시각 이후(같은 시각 포함)에는 목록에 나오지 않는다. */
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    /** 복합 PK — (userId, islandId). */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private UUID userId;
        private UUID islandId;
    }
}

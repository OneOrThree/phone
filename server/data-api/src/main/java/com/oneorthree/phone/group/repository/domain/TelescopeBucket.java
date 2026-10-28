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
import java.util.List;
import java.util.UUID;

/**
 * 망원경 1시간 목록 스냅샷 (GROMO-2306, V125) — 이 사람의 이 버킷에 뽑힌 새 섬 후보, 표시 순서 그대로.
 *
 * <p>쓰기는 {@code TelescopeBucketRepository.insertIfAbsent} 의 네이티브 INSERT 하나다 — 이 매핑은 스키마 선언과
 * 읽기용이다(Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 테이블이 있어야 한다). 한 번 만든 행은 바뀌지 않는다.
 * {@code created_at} 은 표의 DEFAULT 가 채우는 기록용 열이라 매핑하지 않는다.
 */
@Entity
@Table(name = "telescope_buckets")
@IdClass(TelescopeBucket.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TelescopeBucket {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Id
    @Column(name = "bucket_start", nullable = false)
    private Instant bucketStart;

    /** 뽑은 순서 그대로의 섬 id(최대 5) — 배열을 밖으로 내지 않도록 게터는 아래 불변 목록이다. */
    @Getter(AccessLevel.NONE)
    @Column(name = "island_ids", nullable = false)
    private UUID[] islandIds;

    /** 첫 섬이 뽑힌 순간 정원이 남아 있었다 — 그 섬이 이 버킷 동안 가까운 섬이다. */
    @Column(name = "has_nearby", nullable = false)
    private boolean hasNearby;

    /** @return 뽑은 순서 그대로의 섬 id(불변) */
    public List<UUID> getIslandIds() {
        return List.of(islandIds);
    }

    /** 복합 PK — (userId, bucketStart). */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private UUID userId;
        private Instant bucketStart;
    }
}

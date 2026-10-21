package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.TelescopeBucket;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 망원경 1시간 목록 스냅샷 (GROMO-2306, V125). 쓰기 진입점은 {@code TelescopeService.list} 하나다. */
public interface TelescopeBucketRepository extends JpaRepository<TelescopeBucket, TelescopeBucket.Key> {

    /**
     * 이 사람의 이 버킷 스냅샷.
     *
     * @return 없으면 그 버킷의 첫 요청이다
     */
    Optional<TelescopeBucket> findByUserIdAndBucketStart(UUID userId, Instant bucketStart);

    /**
     * 스냅샷을 넣는다 — 이미 있으면 아무것도 바꾸지 않는다(두 기기 동시 첫 요청이면 먼저 커밋한 쪽이 이긴다). 호출자는
     * 넣은 뒤 {@link #findByUserIdAndBucketStart} 로 다시 읽어 이긴 행을 쓴다.
     *
     * @param islandIds 뽑은 섬 id 의 Postgres 배열 리터럴({@code {id1,id2}}, 없으면 {@code {}}) — 순서가 표시 순서다
     * @return 넣은 행 수(0 또는 1)
     */
    @Modifying
    @Query(value = "INSERT INTO telescope_buckets (user_id, bucket_start, island_ids, has_nearby) "
            + "VALUES (:userId, :bucketStart, CAST(:islandIds AS uuid[]), :hasNearby) "
            + "ON CONFLICT (user_id, bucket_start) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("bucketStart") Instant bucketStart,
                       @Param("islandIds") String islandIds, @Param("hasNearby") boolean hasNearby);

    /**
     * 이 사람의 지난 버킷 행을 지운다 — 새 버킷 행을 넣을 때만 부른다(정리 잡 없음, 핀의 {@code deleteExpiredOf} 와
     * 같은 «쓸 때 자기 것만»). 표가 사람마다 한 행 남짓으로 유지된다.
     */
    @Modifying
    @Query("DELETE FROM TelescopeBucket b WHERE b.userId = :userId AND b.bucketStart < :bucketStart")
    int deleteOlderThan(@Param("userId") UUID userId, @Param("bucketStart") Instant bucketStart);

    /**
     * 탈퇴자의 스냅샷을 전부 지운다 — 사용자 행은 소프트 삭제라 V125 의 {@code ON DELETE CASCADE} 가 돌지 않는다.
     *
     * @param userId 탈퇴하는 유저
     * @return 지운 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM TelescopeBucket b WHERE b.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}

package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.TelescopePin;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 망원경 핀 (GROMO-2268, V115). 쓰기 진입점은 {@code TelescopePinService} 하나다. */
public interface TelescopePinRepository extends JpaRepository<TelescopePin, TelescopePin.Key> {

    /**
     * 만료 안 된 핀을 오래된 순으로 — 같은 시각이면 섬 id 로 고정한다. 만료는 읽을 때 거른다(정리 잡 없음).
     * 그 섬을 아직 보여 줄 수 있는지(공개·생존·소속)는 보지 않는다 — 그건 후보와 같은 술어인
     * {@code GroupRepository#findTelescopeVisibleAmong} 의 몫이다.
     */
    @Query("SELECT p FROM TelescopePin p WHERE p.userId = :userId AND p.expiresAt > :now "
            + "ORDER BY p.pinnedAt, p.islandId")
    List<TelescopePin> findLive(@Param("userId") UUID userId, @Param("now") Instant now);

    /**
     * 핀을 넣는다 — 이미 있으면 아무것도 바꾸지 않는다(멱등, 넣은 시각을 갱신하지 않는다).
     *
     * @return 넣은 행 수. 1 이면 새 핀이고 0 이면 이미 있던 핀이다(호출자가 만료 행을 먼저 지웠으므로 «만료 안 된» 핀이다)
     */
    @Modifying
    @Query(value = "INSERT INTO telescope_pins (user_id, island_id, source, promotion_id, pinned_at, expires_at) "
            + "VALUES (:userId, :islandId, :source, :promotionId, :now, :expiresAt) "
            + "ON CONFLICT (user_id, island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("islandId") UUID islandId,
                       @Param("source") String source, @Param("promotionId") UUID promotionId,
                       @Param("now") Instant now, @Param("expiresAt") Instant expiresAt);

    /**
     * 이 사람의 만료된 핀을 지운다 — 같은 사람이 핀을 넣을 때만 부른다. 읽기 필터가 정본이라 안 지워도 틀리지 않고,
     * 지우면 «만료된 핀이 있으면 덮어쓴다» 가 지우고 넣기로 끝나며 표가 사람마다 하루치 이상 불어나지 않는다.
     */
    @Modifying
    @Query("DELETE FROM TelescopePin p WHERE p.userId = :userId AND p.expiresAt <= :now")
    int deleteExpiredOf(@Param("userId") UUID userId, @Param("now") Instant now);

    /**
     * 핀 한 개를 지운다 — 없어도 오류가 아니다.
     *
     * @return 지운 행 수(0 또는 1)
     */
    @Modifying
    @Query("DELETE FROM TelescopePin p WHERE p.userId = :userId AND p.islandId = :islandId")
    int deletePin(@Param("userId") UUID userId, @Param("islandId") UUID islandId);

    /**
     * 탈퇴자의 핀을 전부 지운다 (GROMO-2268, 계약 §0 N42). 그 사람의 개인 목록일 뿐 남의 판정 근거가 아니라 남길
     * 이유가 없다 — 사용자 행은 소프트 삭제라 V115 의 {@code ON DELETE CASCADE} 가 돌지 않는다.
     *
     * @param userId 탈퇴하는 유저
     * @return 지운 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM TelescopePin p WHERE p.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}

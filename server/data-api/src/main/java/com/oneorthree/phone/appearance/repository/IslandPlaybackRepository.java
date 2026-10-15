package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.IslandPlayback;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/** 섬 재생 상태 (GROMO-1779) — writer 는 재생 PATCH 하나다. */
public interface IslandPlaybackRepository extends JpaRepository<IslandPlayback, UUID> {

    /** 재생 PATCH 의 배타 잠금 — <b>반드시 트랜잭션 안에서</b>. 행 잠금이 곧 version 발급 직렬화다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM IslandPlayback p WHERE p.islandId = :islandId")
    Optional<IslandPlayback> findByIdForUpdate(@Param("islandId") UUID islandId);

    /**
     * 첫 명령이 초기 상태 행을 만든다 — anchor 는 섬 생성 시각(LLD §2: GET 마다 바뀌지 않는 저장된 시각).
     * 생성 시각이 비어 있는 옛 행은 epoch 로 고정한다 — 서비스의 초기 GET 과 같은 값이다.
     * 동시 첫 명령은 ON CONFLICT 에서 상대 커밋을 기다렸다 0 을 받고 곧이은 잠금 조회로 직렬화된다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_playbacks (island_id, effective_at) "
            + "SELECT g.id, COALESCE(g.created_at, CAST('epoch' AS timestamptz)) FROM groups g WHERE g.id = :islandId "
            + "ON CONFLICT (island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("islandId") UUID islandId);
}

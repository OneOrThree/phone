package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandWallet;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface IslandWalletRepository extends JpaRepository<IslandWallet, UUID> {

    /**
     * 잔액을 바꾸는 경로 전용 배타 잠금 — <b>반드시 트랜잭션 안에서</b>.
     * 잠금 순서(LLD §4)상 지갑은 섬·시설·정책 잠금 <b>뒤</b>에 잡는다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM IslandWallet w WHERE w.islandId = :islandId")
    Optional<IslandWallet> findByIdForUpdate(@Param("islandId") UUID islandId);

    /**
     * 지갑이 없는 섬(레거시 생성 경로 등)의 첫 접근 때 만든다 — {@code ON CONFLICT DO NOTHING}
     * 이라 동시 첫 접근이 UNIQUE 위반으로 트랜잭션을 오염시키지 않는다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_wallets (island_id) VALUES (:islandId) "
            + "ON CONFLICT (island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("islandId") UUID islandId);
}

package com.oneorthree.phone.currency.repository;

import com.oneorthree.phone.currency.repository.domain.UserFishWallet;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/** 개인 물고기 지갑 (GROMO-1924) — {@code IslandWalletRepository} 와 같은 모양이다. */
public interface UserFishWalletRepository extends JpaRepository<UserFishWallet, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM UserFishWallet w WHERE w.userId = :userId")
    Optional<UserFishWallet> findByIdForUpdate(@Param("userId") UUID userId);

    /** 첫 적립 전에 0원 행을 만든다 — 동시 첫 적립 둘이 둘 다 INSERT 하지 않게 충돌은 무시한다. */
    @Modifying
    @Query(value = "INSERT INTO user_fish_wallets (user_id) VALUES (:userId) "
            + "ON CONFLICT (user_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId);
}

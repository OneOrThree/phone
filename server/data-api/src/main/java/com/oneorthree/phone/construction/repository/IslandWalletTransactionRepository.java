package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandWalletTransaction;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransactionType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface IslandWalletTransactionRepository extends JpaRepository<IslandWalletTransaction, UUID> {

    /** 같은 기입의 재실행인가 — 유니크 제약 앞단의 조용한 스킵 판정이다. 멱등 scope 는
     *  LLD 와 같은 (섬, operation=type, 키)라 DB 유일키와 같은 세 축을 본다. */
    boolean existsByIslandIdAndTypeAndIdempotencyKey(UUID islandId,
                                                     IslandWalletTransactionType type,
                                                     String idempotencyKey);
}

package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandWalletTransaction;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransactionType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface IslandWalletTransactionRepository extends JpaRepository<IslandWalletTransaction, UUID> {

    /** 같은 기입의 재실행인가 — 유니크 제약 앞단의 조용한 스킵 판정이다. 멱등 scope 는
     *  LLD 와 같은 (섬, operation=type, 키)라 DB 유일키와 같은 세 축을 본다. */
    boolean existsByIslandIdAndTypeAndIdempotencyKey(UUID islandId,
                                                     IslandWalletTransactionType type,
                                                     String idempotencyKey);

    /**
     * 공동 가계부 한 페이지 (GROMO-1895) — 기간 {@code [from, to)} 안의 주어진 사유 행을 최신순
     * {@code (createdAt, id)} 내림차순 keyset 으로 자른다. 첫 페이지는 호출측이 {@code to} 와 가장 큰 UUID 를
     * 경계로 넘긴다 — {@code to} 가 배타 상한이라 경계 행 자체는 기간 조건에서 이미 빠진다.
     *
     * <p>ponytail: 섬 축 인덱스가 유일키 {@code (island_id, type, idempotency_key)} 앞머리뿐이라 섬 한 곳의
     * 원장 행을 훑고 정렬한다 — 섬당 행 수가 커지면 {@code (island_id, created_at, id)} 인덱스를 마이그레이션으로 더한다.
     */
    @Query("SELECT t FROM IslandWalletTransaction t WHERE t.islandId = :islandId AND t.type IN :types"
            + " AND t.createdAt >= :from AND t.createdAt < :to"
            + " AND (t.createdAt < :beforeCreatedAt OR (t.createdAt = :beforeCreatedAt AND t.id < :beforeId))"
            + " ORDER BY t.createdAt DESC, t.id DESC")
    List<IslandWalletTransaction> findLedgerPage(@Param("islandId") UUID islandId,
            @Param("types") Collection<IslandWalletTransactionType> types,
            @Param("from") Instant from, @Param("to") Instant to,
            @Param("beforeCreatedAt") Instant beforeCreatedAt, @Param("beforeId") UUID beforeId,
            Pageable pageable);

    /** 기간 {@code [from, to)} 의 사유별 합 — 가계부의 기간 합계는 페이지·방향 필터와 무관한 전체 합이다. */
    @Query("SELECT t.type AS type, SUM(t.amount) AS total FROM IslandWalletTransaction t"
            + " WHERE t.islandId = :islandId AND t.createdAt >= :from AND t.createdAt < :to GROUP BY t.type")
    List<TypeTotal> sumByTypeBetween(@Param("islandId") UUID islandId,
            @Param("from") Instant from, @Param("to") Instant to);

    /** 사유별 합 투영. */
    interface TypeTotal {

        IslandWalletTransactionType getType();

        Long getTotal();
    }
}

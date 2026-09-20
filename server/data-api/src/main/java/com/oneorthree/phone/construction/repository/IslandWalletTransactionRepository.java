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

    /**
     * 공동 가계부의 <b>집중 적립 묶음</b> (GROMO-1990) — 기간 {@code [from, to)} 의 {@code CONTRIBUTION} 을
     * 하루 단위로 접는다. 집중 보상이 매분 적립으로 바뀌면서 이 사유만 주민 1명당 하루 최대 480행이 되어,
     * 건별로 내보내면 가계부 한 달이 수천 줄이 된다. <b>원장은 건별 그대로 두고 조회에서만 묶는다</b> —
     * 감사 추적(어느 분에 얼마가 들어왔는가)은 행에 남아 있어야 한다.
     *
     * <p>묶는 축은 <b>KST 날짜</b>다 — 이 조회의 창({@code month})이 이미 KST 달력 월이라 같은 체인에서
     * 축을 섞지 않는다(적립 상한의 UTC 축과는 다른 체인이다).
     *
     * <p>묶음의 대표 {@code id}·{@code createdAt} 은 그 날 <b>가장 이른</b> 행의 것이다 — 최신순 keyset 에서
     * 묶음의 «끝»이 그 자리라, 다음 페이지가 그보다 오래된 행부터 이어져 빠짐·중복이 생기지 않는다.
     *
     * <p>별칭을 따옴표로 감싼 것은 의도다 — PostgreSQL 은 따옴표 없는 별칭을 소문자로 내려서
     * 인터페이스 투영({@code getStartedAt})이 열을 못 찾는다.
     *
     * @param zone 묶음 날짜의 시간대 id(= {@code ZonePolicy.KST})
     * @return 묶음 행(최신순). 한 달이라 최대 31행이다
     */
    @Query(value = "SELECT (array_agg(t.id ORDER BY t.created_at, t.id))[1] AS \"id\","
            + " MIN(t.created_at) AS \"startedAt\", MAX(t.created_at) AS \"endedAt\","
            + " SUM(t.amount) AS \"amount\", COUNT(*) AS \"entryCount\""
            + " FROM island_wallet_transactions t"
            + " WHERE t.island_id = :islandId AND t.type = 'CONTRIBUTION'"
            + " AND t.created_at >= :from AND t.created_at < :to"
            + " GROUP BY (t.created_at AT TIME ZONE :zone)::date"
            + " ORDER BY MIN(t.created_at) DESC", nativeQuery = true)
    List<DailyContribution> sumContributionsByDay(@Param("islandId") UUID islandId,
            @Param("from") Instant from, @Param("to") Instant to, @Param("zone") String zone);

    /** 하루치 집중 적립 묶음 투영. */
    interface DailyContribution {

        /** 그 날 가장 이른 행의 id — 묶음의 keyset 커서다. */
        UUID getId();

        /** 그 날 첫 적립 시각 — 묶음의 {@code createdAt} 이다. */
        Instant getStartedAt();

        /** 그 날 마지막 적립 시각. */
        Instant getEndedAt();

        Long getAmount();

        Long getEntryCount();
    }

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

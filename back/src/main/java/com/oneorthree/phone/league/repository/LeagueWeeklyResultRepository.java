package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeagueWeeklyResultRepository extends JpaRepository<LeagueWeeklyResult, UUID> {

    Optional<LeagueWeeklyResult> findTopByUserIdOrderByCreatedAtDesc(UUID userId);

    /**
     * 주차·결과 조건의 정산 로그를 id keyset 으로 한 페이지 조회한다.
     * 결과 발표는 STAY(대다수)를 포함해 정산된 전원이 대상이라 전체를 한 번에 로드하지 않고
     * {@code cursorId} 이후를 페이지 단위로 끊어 읽는다(첫 페이지는 cursorId=null).
     */
    @Query("""
            SELECT r FROM LeagueWeeklyResult r
            WHERE r.weekStartAt = :weekStartAt
              AND r.result IN :results
              AND (:cursorId IS NULL OR r.id > :cursorId)
            ORDER BY r.id ASC
            """)
    List<LeagueWeeklyResult> findResultPageAfter(
            @Param("weekStartAt") Instant weekStartAt,
            @Param("results") Collection<LeagueWeeklyResultType> results,
            @Param("cursorId") UUID cursorId,
            Pageable pageable);

    /**
     * 지정한 (사용자·주차) 결과를 확인 처리한다(GROMO-567). 클라가 GET 으로 받은 그 주차만 대상으로 하고,
     * {@code acknowledged_at IS NULL} 조건부 원자적 UPDATE 라 중복·동시 호출에도 최초 1회만 세팅된다(멱등·선점).
     * 대상 행이 없거나 이미 확인된 경우 0 행을 반환한다(no-op).
     *
     * @return 실제로 확인 처리된 행 수(0 또는 1)
     */
    @Modifying(clearAutomatically = true)
    @Query("""
            UPDATE LeagueWeeklyResult r
            SET r.acknowledgedAt = :now
            WHERE r.user.id = :userId
              AND r.weekStartAt = :weekStartAt
              AND r.acknowledgedAt IS NULL
            """)
    int acknowledge(
            @Param("userId") UUID userId,
            @Param("weekStartAt") Instant weekStartAt,
            @Param("now") Instant now);
}

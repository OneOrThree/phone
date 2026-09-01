package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
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

/**
 * 주간 정산 결과(league_weekly_results) 창구. 이 테이블의 행 하나가 곧 "그 유저·그 주차는 정산이 끝났다"는
 * <b>완료 마커</b>라, (user_id, week_start_at) 유니크가 재실행의 이중 정산을 막는 최후 방어선이다.
 *
 * <p>주차 키는 {@code weekStartAt} — KST 월요일 00:00 의 instant 다. 주차 비교는 이 한 축으로만 하고,
 * 결과 조회는 정산 시각(createdAt)이 아니라 주차 키를 기준으로 삼아야 한다.
 */
public interface LeagueWeeklyResultRepository extends JpaRepository<LeagueWeeklyResult, UUID> {

    /**
     * 결과 모달에 띄울 최신 정산 결과 한 건. 주차 키가 아니라 정산 시각 기준이라, 과거 주차를 뒤늦게
     * 복구 정산하면 그 행이 최신으로 올라온다.
     *
     * @param userId 결과의 주인
     * @return 가장 최근에 기록된 결과. 정산 이력이 없으면 빈 값이고 호출측이 hasResult=false 로 내려보낸다
     */
    Optional<LeagueWeeklyResult> findTopByUserIdOrderByCreatedAtDesc(UUID userId);

    /**
     * 지정 유저들 중 해당 주차 완료 마커(정산 결과 행)가 이미 있는 유저 id 만 돌려준다 (GROMO-1239).
     * 정산 페이지(100명) 단위 일괄 선조회로 재실행 시 유저별 exists N+1 을 피한다 — 동시성 정본은
     * settler 가 유저 행 락을 쥔 뒤 하는 단건 재확인({@link #findLatestSettledWeekOnOrAfter})이고,
     * 이 선조회는 락 왕복을 줄이는 빠른 경로 최적화다.
     *
     * @param weekStartAt 정산 대상 주차 키(KST 월요일 00:00) — 정확히 일치하는 행만 본다
     * @param userIds     이번 페이지에서 정산하려는 유저들
     * @return 그중 이미 완료 마커가 있는 유저 id. 이 집합을 빼고 남은 유저만 실제 정산으로 넘긴다
     */
    @Query("""
            SELECT r.user.id FROM LeagueWeeklyResult r
            WHERE r.weekStartAt = :weekStartAt
              AND r.user.id IN :userIds
            """)
    List<UUID> findUserIdsByWeekStartAtAndUserIdIn(
            @Param("weekStartAt") Instant weekStartAt,
            @Param("userIds") Collection<UUID> userIds);

    /**
     * 대상 주차 <b>이후(포함)</b> 결과 중 가장 늦은 주차 키 (GROMO-1239) — settler 가 유저 행
     * 배타 락을 쥔 뒤 mutation 전에 인덱스 조회 한 번으로 멱등 가드 둘을 함께 판정한다:
     * 값 == 대상 주차 → 이미 정산(ALREADY_SETTLED), 값 &gt; 대상 주차 → 더 늦은 주차가 이미
     * 정산돼 티어 체인이 전진함(SKIPPED_SUPERSEDED — 과거 주차 소급 금지), empty → 정산 진행.
     * uq_league_weekly_results_user_week 인덱스가 (user_id, week_start_at) 범위를 그대로 타고,
     * 같은 유니크 제약이 최후 방어선으로 뒤를 받친다.
     *
     * @param userId      정산하려는 유저 (행 락을 이미 쥔 상태로 부른다)
     * @param weekStartAt 정산 대상 주차 키. 이 시각 <b>이상</b>(포함)인 결과만 본다
     * @return 대상 주차 이후 결과 중 가장 늦은 주차 키. 대상 주차와 같으면 이미 정산됨, 더 크면 뒤 주차가
     *         먼저 정산돼 소급이 금지된 상태, 빈 값이면 진행해도 되는 상태다
     */
    @Query("""
            SELECT MAX(r.weekStartAt) FROM LeagueWeeklyResult r
            WHERE r.user.id = :userId
              AND r.weekStartAt >= :weekStartAt
            """)
    Optional<Instant> findLatestSettledWeekOnOrAfter(
            @Param("userId") UUID userId,
            @Param("weekStartAt") Instant weekStartAt);

    /**
     * 주차·결과 조건의 정산 로그를 id keyset 으로 한 페이지 조회한다.
     * 결과 발표는 STAY(대다수)를 포함해 정산된 전원이 대상이라 전체를 한 번에 로드하지 않고
     * {@code cursorId} 이후를 페이지 단위로 끊어 읽는다(첫 페이지는 cursorId=null).
     *
     * @param weekStartAt 발표할 주차 키
     * @param results     실을 결과 종류(승급·강등·유지 등). 빈 컬렉션이면 빈 페이지다
     * @param cursorId    직전 페이지의 마지막 id — 이 값 <b>초과</b>부터 읽는다. 첫 페이지는 null
     * @param pageable    페이지 크기. 정렬은 쿼리가 id 오름차순으로 고정하므로 여기 정렬을 넣지 않는다
     * @return 다음 한 페이지. 크기보다 적게 오면 마지막 페이지다
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
     * @param userId      결과의 주인
     * @param weekStartAt 확인 처리할 주차 키. 클라가 GET 으로 받은 그 주차를 그대로 실어야, 그 사이 배치가
     *                    넣은 새 주차 결과를 못 본 채 삼키지 않는다
     * @param now         확인 시각
     * @return 실제로 확인 처리된 행 수(0 또는 1)
     */
    // flushAutomatically 도 함께 켠다 (GROMO-801 예방) — flush 없이 clear 만 하면 그 시점까지의
    // 미flush 변경이 통째로 버려진다(SocialAccountRepository.deleteByUserId 에서 실제 유실 발생).
    // 지금 이 트랜잭션엔 미flush 변경이 없어 무해하지만, 같은 모양의 지뢰를 남기지 않는다.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
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

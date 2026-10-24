package com.oneorthree.phone.ranking.repository;

import com.oneorthree.phone.ranking.repository.domain.IslandFocusAverage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** 섬별 7일 평균 일 스냅샷 (GROMO-2257, V114). */
public interface IslandFocusAverageRepository
        extends JpaRepository<IslandFocusAverage, IslandFocusAverage.Key> {

    /**
     * 그날의 스냅샷을 <b>한 문장으로</b> 적는다 — 이미 적힌 (날짜, 섬) 행은 건드리지 않고, <b>이 문장이 섬 행을 잠근
     * 시점에 죽어 있는 섬</b>은 적지 않는다.
     *
     * <p>세 배열은 <b>같은 길이·같은 순서</b>다(i 번째가 한 섬의 한 행). {@code unnest} 가 그것을 행으로 펼친다.
     * 평균 배열의 null 은 «주민 0명» 이다 — 0 과 섞지 않는다.
     *
     * <p>{@code ON CONFLICT DO NOTHING} 이라 <b>재실행해도 첫 값이 남는다</b>. 이것이 «같은 날 2회 조회 = 같은 값»
     * 의 멱등 가드다 — 분산 락은 중복 작업을 줄일 뿐 정합성의 유일한 방어선이 아니다.
     *
     * <h2>살아 있는지를 «잠그면서» 다시 묻는다</h2>
     * 호출부가 앞서 읽어 둔 «살아 있는 섬 목록» 은 이 문장이 도는 사이 낡을 수 있다. 마지막 주민의 이탈·계정 탈퇴가
     * 섬을 닫고 {@code IslandPurgeService} 가 이 표의 그 섬 행을 지운 <b>뒤에</b> 이 INSERT 가 커밋되면 닫힌 섬의
     * 행이 되살아나 영영 치워지지 않는다 — 섬은 묘비만 남겨 FK {@code ON DELETE CASCADE} 가 돌지 않고, 다음 배치는
     * 죽은 섬을 건너뛴다. 그래서 {@code alive} CTE 가 넘겨받은 섬 중 <b>지금도</b> 미삭제·미종료인 섬의
     * {@code islands} 행을 id 오름차순으로 {@code FOR SHARE} 잠그고, 그 행에만 INSERT 를 건다. 삭제는 섬 행 잠금
     * (JPA {@code PESSIMISTIC_WRITE} — PostgreSQL 에선 {@code FOR NO KEY UPDATE})을 쥔 채 지우므로
     * ({@code IslandPurgePort} 계약) 둘이 이 잠금에서 직렬화된다. INSERT 의 FK 검사가 쥐는 {@code FOR KEY SHARE} 는
     * 그 잠금과 <b>충돌하지 않아</b> INSERT 만으로는 직렬화되지 않는다 — {@code FOR SHARE} 를 걷어내면 이 보호가 사라진다.
     * <ul>
     *   <li>삭제가 먼저면 이 문장이 삭제 트랜잭션이 끝날 때까지 기다리고, READ COMMITTED 재평가가 묘비가 선 행을
     *       {@code alive} 에서 뺀다 — 그 섬의 행은 적히지 않는다.</li>
     *   <li>이 문장이 먼저면 삭제가 이쪽 커밋까지 기다렸다가 적힌 행을 지운다.</li>
     * </ul>
     * 잠금 절을 가진 CTE 는 PostgreSQL 이 본문에 녹이지 않고 따로 실행한다 — {@code AS MATERIALIZED}(PostgreSQL 12+)로
     * 그것을 명시했을 뿐 동작은 같다. INSERT 에 닿는 행은 모두 그 섬의 잠금과 생존 재확인을 거친 행이다. 잠금은
     * 트랜잭션 끝까지 쥐므로 호출부({@code IslandFocusAverageSnapshotService})의 커밋이 곧 해제다.
     *
     * <p>트랜잭션 경계는 여기서 열지 않는다(규약 §4·§5) — 호출부인 {@code IslandFocusAverageSnapshotService} 가
     * 소유한다.
     *
     * @param snapshotDate  배치가 도는 날의 KST 날짜
     * @param islandIds     섬 id
     * @param memberCounts  섬별 현재 주민 수(0 이상)
     * @param averages      섬별 하루 평균 집중(분). 주민 0명이면 null
     * @return 새로 적힌 행 수. 이미 적힌 (날짜, 섬)과 그사이 죽은 섬은 세지 않으므로 재실행이면 0 이고,
     *     넘긴 섬 수보다 작을 수 있다
     */
    @Modifying
    @Query(value = "WITH alive AS MATERIALIZED ("
            + "SELECT g.id FROM islands g "
            + "WHERE g.id = ANY(CAST(:islandIds AS uuid[])) "
            + "AND g.deleted_at IS NULL AND g.status <> 'ENDED' "
            + "ORDER BY g.id FOR SHARE) "
            + "INSERT INTO island_focus_averages "
            + "(snapshot_date, island_id, member_count, avg_minutes_per_member_day) "
            + "SELECT CAST(:snapshotDate AS date), r.island_id, r.member_count, r.avg_minutes "
            + "FROM unnest(CAST(:islandIds AS uuid[]), CAST(:memberCounts AS integer[]), "
            + "CAST(:averages AS integer[])) AS r(island_id, member_count, avg_minutes) "
            + "JOIN alive ON alive.id = r.island_id "
            + "ON CONFLICT (snapshot_date, island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("snapshotDate") LocalDate snapshotDate,
                       @Param("islandIds") UUID[] islandIds,
                       @Param("memberCounts") Integer[] memberCounts,
                       @Param("averages") Integer[] averages);

    /**
     * 섬마다 <b>가장 최근 snapshot_date 의 행 하나</b> — 읽기 쪽(망원경 목록)의 유일한 질의다.
     * {@code DISTINCT ON} 이 섬당 첫 행만 남기고, {@code (island_id, snapshot_date DESC)} 인덱스(V114)가 받친다.
     *
     * <p>«가장 최근 <b>값이 있는</b> 행» 이 아니다 — 최근 행의 평균이 null(주민 0명)이면 그것이 답이다. 옛 값으로
     * 되돌아가지 않는다.
     *
     * @param islandIds 조회할 섬 id. 비어 있으면 SQL 이 깨지므로 호출부가 걸러야 한다
     * @return 행이 있는 섬만 1건씩(요청의 부분집합). 한 번도 집계되지 않은 섬은 빠진다
     */
    @Query(value = "SELECT DISTINCT ON (a.island_id) a.* FROM island_focus_averages a "
            + "WHERE a.island_id IN (:islandIds) "
            + "ORDER BY a.island_id, a.snapshot_date DESC", nativeQuery = true)
    List<IslandFocusAverage> findLatestByIslandIds(@Param("islandIds") Collection<UUID> islandIds);

    /**
     * {@code cutoff} 보다 오래된 행을 지우되 <b>섬마다 가장 최근 행은 남긴다</b> (GROMO-2280) — cutoff 보다 오래됐어도.
     * 읽기({@link #findLatestByIslandIds})가 «섬의 최신 행» 을 답으로 주므로 그 행을 지우면 한동안 새 행이 없던 섬의
     * 값이 사라진다. 판정은 섬 단위라 다른 섬의 행은 영향을 주지 않는다. {@code (island_id, snapshot_date DESC)} 인덱스가
     * {@code EXISTS} 를 받친다. 트랜잭션 경계는 호출부({@code IslandFocusAverageSnapshotService})가 소유한다.
     *
     * @param cutoff 이 날짜 «미만» 의 행이 지울 후보다(그날 행은 남는다)
     * @return 지운 행 수
     */
    @Modifying
    @Query(value = "DELETE FROM island_focus_averages a WHERE a.snapshot_date < CAST(:cutoff AS date) "
            + "AND EXISTS (SELECT 1 FROM island_focus_averages b "
            + "WHERE b.island_id = a.island_id AND b.snapshot_date > a.snapshot_date)", nativeQuery = true)
    int deleteOlderThanKeepingLatest(@Param("cutoff") LocalDate cutoff);
}

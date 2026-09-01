package com.oneorthree.phone.league.repository;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.NoArgGenerator;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** PostgreSQL ON CONFLICT로 일간 전역 순위 스냅샷을 원자적 upsert한다. */
@Repository
@RequiredArgsConstructor
public class LeagueRankSnapshotUpsertRepository {

    private static final String UPSERT_SQL = """
            INSERT INTO league_rank_snapshots (id, user_id, rank, created_at)
            VALUES (:id, :userId, :rank, :createdAt)
            ON CONFLICT (user_id, created_at)
            DO UPDATE SET rank = EXCLUDED.rank
            """;

    /**
     * 스레드 안전한 시간 기반 UUIDv7 생성기 — 스냅샷마다 새로 만들지 않고 1회 생성 후 재사용한다.
     */
    private static final NoArgGenerator ID_GENERATOR = Generators.timeBasedEpochRandomGenerator();

    private final NamedParameterJdbcTemplate jdbcTemplate;

    /**
     * 하루치 순위를 한 번에 밀어 넣는다. (user_id, created_at) 충돌 시 rank 만 덮으므로, 같은 날 여러 번
     * 돌려도 행이 늘지 않고 최신 순위로 수렴한다 — 배치 재실행을 안전하게 만드는 지점이다.
     *
     * @param createdAt 스냅샷 날짜(KST 축). 전 행이 이 한 값을 공유한다
     * @param snapshots 유저별 순위. 비어 있으면 SQL 을 아예 보내지 않는다
     */
    public void upsertAll(LocalDate createdAt, List<SnapshotRank> snapshots) {
        if (snapshots.isEmpty()) {
            return;
        }
        MapSqlParameterSource[] parameters = snapshots.stream()
                .map(snapshot -> new MapSqlParameterSource()
                        .addValue("id", ID_GENERATOR.generate())
                        .addValue("userId", snapshot.userId())
                        .addValue("rank", snapshot.rank())
                        .addValue("createdAt", createdAt))
                .toArray(MapSqlParameterSource[]::new);
        jdbcTemplate.batchUpdate(UPSERT_SQL, parameters);
    }

    /**
     * upsert 한 줄의 입력. id 와 날짜는 저장 시점에 붙으므로 여기엔 유저와 순위만 담는다.
     *
     * @param userId 순위의 주인
     * @param rank   1 부터 시작하는 전역 순번
     */
    public record SnapshotRank(UUID userId, int rank) {
    }
}

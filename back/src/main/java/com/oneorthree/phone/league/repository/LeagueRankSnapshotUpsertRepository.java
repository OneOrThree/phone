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

    // 스레드 안전한 시간 기반 UUIDv7 생성기 — 스냅샷마다 새로 만들지 않고 1회 생성 후 재사용한다.
    private static final NoArgGenerator ID_GENERATOR = Generators.timeBasedEpochRandomGenerator();

    private final NamedParameterJdbcTemplate jdbcTemplate;

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

    public record SnapshotRank(UUID userId, int rank) {
    }
}

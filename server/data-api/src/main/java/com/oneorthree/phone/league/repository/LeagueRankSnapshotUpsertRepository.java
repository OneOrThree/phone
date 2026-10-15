package com.oneorthree.phone.league.repository;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.NoArgGenerator;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** PostgreSQL ON CONFLICT로 일간 전역 순위 스냅샷을 원자적 upsert한다. */
@Repository
@RequiredArgsConstructor
public class LeagueRankSnapshotUpsertRepository {

    /**
     * 활성 사용자만 쓴다 — users 행을 {@code FOR SHARE} 로 잠근 SELECT 가 0행이면 INSERT 도 0행이다(GROMO-1944).
     * 탈퇴는 users 배타 락을 쥔 채 그 사람의 스냅샷을 지우므로, 탈퇴 진행 중이면 여기서 커밋을 기다렸다가
     * 술어 재평가(is_deleted=true)로 빠진다. 락 없이 쓰면 방금 지운 행이 다시 생긴다.
     */
    private static final String UPSERT_SQL = """
            INSERT INTO league_rank_snapshots (id, user_id, rank, created_at)
            SELECT :id, u.id, :rank, :createdAt
            FROM users u
            WHERE u.id = :userId AND u.is_deleted = false
            FOR SHARE
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
     * <p><b>별도 READ COMMITTED 트랜잭션</b>이다 — 호출하는 순위 추월 배치는 REPEATABLE READ 라, 그 스냅샷 뒤에
     * 커밋된 탈퇴 행에 {@code FOR SHARE} 를 걸면 직렬화 실패로 하루치 배치 전체가 롤백된다. 여기서는 탈퇴한
     * 사용자의 줄만 조용히 빠진다. 스냅샷은 같은 날 재실행에 멱등이라 배치 본체와 따로 커밋돼도 된다.
     * 탈퇴한 사용자는 이 배치에 404 를 돌려받을 호출자가 없어 <b>건너뛰는 것</b>이 거절이다.
     *
     * @param createdAt 스냅샷 날짜(KST 축). 전 행이 이 한 값을 공유한다
     * @param snapshots 유저별 순위. 비어 있으면 SQL 을 아예 보내지 않는다. 탈퇴·부재 사용자의 줄은 쓰이지 않는다
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, isolation = Isolation.READ_COMMITTED)
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

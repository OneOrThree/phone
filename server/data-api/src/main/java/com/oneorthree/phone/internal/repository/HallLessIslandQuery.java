package com.oneorthree.phone.internal.repository;

import com.oneorthree.phone.internal.dto.HallLessIslandCleanupView;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Array;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 마을회관 없는 섬 판정과 영향 집계 (GROMO-2763) — 섬·시설·멤버십·집중·지갑·가입 신청·홍보를 가로지르는 읽기라
 * 한 문장으로 같은 스냅샷에서 읽는다. 쓰기·잠금이 없다.
 *
 * <p>회관은 건물 트리의 뿌리라 회관 행이 없는 섬에는 다른 건물도 없다. 짓는 중({@code BUILDING})인 회관도 «있음» 이다.
 * 같은 술어를 런북(docs/prd/fishcat/island-membership/hall-less-island-cleanup.md)의 확인 SQL 이 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class HallLessIslandQuery {

    private static final String TARGET_PREDICATE = """
            i.deleted_at IS NULL AND i.status <> 'ENDED'
              AND NOT EXISTS (SELECT 1 FROM island_facilities f WHERE f.island_id = i.id AND f.building_id = 'hall')
            """;

    private static final String IS_TARGET_SQL =
            "SELECT EXISTS (SELECT 1 FROM islands i WHERE i.id = :islandId AND " + TARGET_PREDICATE + ")";

    private static final String SUMMARY_SQL = """
            WITH target AS (SELECT i.id FROM islands i WHERE %s),
            resident AS (
                SELECT DISTINCT m.user_id FROM group_members m JOIN target t ON t.id = m.group_id
                WHERE m.is_left = false),
            keeper AS (
                SELECT r.user_id FROM resident r WHERE EXISTS (
                    SELECT 1 FROM group_members o JOIN islands oi ON oi.id = o.group_id
                    WHERE o.user_id = r.user_id AND o.is_left = false
                      AND oi.deleted_at IS NULL AND oi.status <> 'ENDED'
                      AND oi.id NOT IN (SELECT id FROM target)))
            SELECT (SELECT array_agg(id ORDER BY id) FROM target) AS island_ids,
                   (SELECT count(*) FROM resident) AS residents,
                   (SELECT count(*) FROM keeper) AS keepers,
                   (SELECT count(*) FROM focus_session_details d JOIN target t ON t.id = d.island_id
                     WHERE d.lifecycle IN ('ACTIVE', 'PAUSED') AND d.kind = 'ISLAND') AS island_sessions,
                   (SELECT count(*) FROM focus_session_details d JOIN target t ON t.id = d.island_id
                     WHERE d.lifecycle IN ('ACTIVE', 'PAUSED') AND d.kind = 'SEA') AS sea_voyages,
                   (SELECT COALESCE(sum(w.balance), 0) FROM island_wallets w JOIN target t ON t.id = w.island_id)
                       AS wallet_fish,
                   (SELECT count(*) FROM island_join_requests j JOIN target t ON t.id = j.island_id
                     WHERE j.status = 'PENDING') AS pending_join_requests,
                   (SELECT count(*) FROM island_promotions p JOIN target t ON t.id = p.island_id
                     WHERE p.issue_date >= :today) AS upcoming_promotions,
                   (SELECT count(*) FROM onboarding_islands o JOIN target t ON t.id = o.island_id)
                       AS onboarding_reservations
            """.formatted(TARGET_PREDICATE);

    private final NamedParameterJdbcTemplate jdbc;

    /** 지금 대상인가 — 섬 행을 잠근 뒤 다시 묻는다(목록을 뽑은 뒤 회관이 생겼거나 섬이 닫혔을 수 있다). */
    public boolean isTarget(UUID islandId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(IS_TARGET_SQL, Map.of("islandId", islandId), Boolean.class));
    }

    /**
     * 대상 섬과 영향.
     *
     * @param today 홍보 칸을 «오늘 이후» 로 가를 KST 날짜
     */
    public HallLessIslandCleanupView.Summary summarize(LocalDate today) {
        return jdbc.queryForObject(SUMMARY_SQL, Map.of("today", today), (rs, row) -> {
            List<UUID> islandIds = uuids(rs.getArray("island_ids"));
            long residents = rs.getLong("residents");
            long keepers = rs.getLong("keepers");
            return new HallLessIslandCleanupView.Summary(islandIds.size(), islandIds, residents, keepers,
                    residents - keepers, rs.getLong("island_sessions"), rs.getLong("sea_voyages"),
                    rs.getLong("wallet_fish"), rs.getLong("pending_join_requests"),
                    rs.getLong("upcoming_promotions"), rs.getLong("onboarding_reservations"));
        });
    }

    private static List<UUID> uuids(Array array) throws SQLException {
        // 대상이 없으면 array_agg 가 NULL 이다.
        return array == null ? List.of() : Arrays.asList((UUID[]) array.getArray());
    }
}

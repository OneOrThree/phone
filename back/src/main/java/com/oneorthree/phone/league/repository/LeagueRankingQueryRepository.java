package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueRankingPosition;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.user.domain.Occupation;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** DailyFocusStat을 단일 점수 원천으로 사용하는 전역 리그 조회 repository. */
@Repository
@RequiredArgsConstructor
public class LeagueRankingQueryRepository {

    private static final String WEEKLY_TOTALS = """
            SELECT u.id AS user_id,
                   u.nickname AS nickname,
                   u.tier_level AS tier_level,
                   COALESCE(SUM(d.total_focus_seconds), 0) AS total_focus_seconds
              FROM users u
              LEFT JOIN daily_focus_stats d
                ON d.user_id = u.id
               AND d.date BETWEEN :fromDate AND :toDate
             WHERE u.is_deleted = false
               AND u.is_guest = false
            """;

    private static final String GROUP_BY_USER = """
             GROUP BY u.id, u.nickname, u.tier_level
            """;

    private final NamedParameterJdbcTemplate jdbcTemplate;

    public List<LeagueRankingRow> findTop(LocalDate fromDate, LocalDate toDate,
                                           Occupation occupation, int limit) {
        validateRange(fromDate, toDate);
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be positive");
        }

        String occupationCondition = occupation == null ? "" : " AND u.occupation = :occupation\n";
        String sql = WEEKLY_TOTALS + occupationCondition + GROUP_BY_USER
                + " ORDER BY total_focus_seconds DESC, u.id ASC LIMIT :limit";
        MapSqlParameterSource parameters = rangeParameters(fromDate, toDate)
                .addValue("limit", limit);
        if (occupation != null) {
            parameters.addValue("occupation", occupation.name());
        }
        return jdbcTemplate.query(sql, parameters, this::mapRankingRow);
    }

    /**
     * 전역 순위용 keyset 페이지. 집중 시간 내림차순, 동률이면 user id 오름차순으로
     * 정렬하고 직전 페이지의 마지막 점수·user id를 배타적 커서로 사용한다.
     */
    public List<LeagueRankingRow> findGlobalRankingPage(
            LocalDate fromDate,
            LocalDate toDate,
            Integer cursorFocusSeconds,
            UUID cursorUserId,
            int limit) {
        validateRange(fromDate, toDate);
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be positive");
        }
        if ((cursorFocusSeconds == null) != (cursorUserId == null)) {
            throw new IllegalArgumentException("ranking cursor values must both be null or non-null");
        }

        String cursorCondition = cursorUserId == null ? "" : """
                 HAVING COALESCE(SUM(d.total_focus_seconds), 0) < :cursorFocusSeconds
                    OR (COALESCE(SUM(d.total_focus_seconds), 0) = :cursorFocusSeconds
                        AND u.id > :cursorUserId)
                """;
        String sql = WEEKLY_TOTALS + GROUP_BY_USER + cursorCondition
                + " ORDER BY total_focus_seconds DESC, u.id ASC LIMIT :limit";
        MapSqlParameterSource parameters = rangeParameters(fromDate, toDate)
                .addValue("limit", limit);
        if (cursorUserId != null) {
            parameters.addValue("cursorFocusSeconds", cursorFocusSeconds)
                    .addValue("cursorUserId", cursorUserId);
        }
        return jdbcTemplate.query(sql, parameters, this::mapRankingRow);
    }

    public Optional<LeagueRankingPosition> findRankOf(UUID userId, LocalDate fromDate, LocalDate toDate) {
        validateRange(fromDate, toDate);
        String sql = "WITH target AS ("
                + WEEKLY_TOTALS + " AND u.id = :userId\n" + GROUP_BY_USER
                + "), higher_ranked AS ("
                + " SELECT COUNT(*) AS user_count FROM ("
                + " SELECT u.id FROM users u"
                + " LEFT JOIN daily_focus_stats d ON d.user_id = u.id"
                + " AND d.date BETWEEN :fromDate AND :toDate"
                + " CROSS JOIN target t"
                + " WHERE u.is_deleted = false AND u.is_guest = false"
                + " GROUP BY u.id, t.user_id, t.total_focus_seconds"
                + " HAVING COALESCE(SUM(d.total_focus_seconds), 0) > t.total_focus_seconds"
                + " OR (COALESCE(SUM(d.total_focus_seconds), 0) = t.total_focus_seconds"
                + " AND u.id < t.user_id)"
                + " ) preceding_users)"
                + " SELECT higher_ranked.user_count + 1 AS ranking_position,"
                + " target.tier_level, target.total_focus_seconds"
                + " FROM target CROSS JOIN higher_ranked";
        MapSqlParameterSource parameters = rangeParameters(fromDate, toDate)
                .addValue("userId", userId);
        return jdbcTemplate.query(sql, parameters, (resultSet, rowNumber) -> new LeagueRankingPosition(
                        Math.toIntExact(resultSet.getLong("ranking_position")),
                        resultSet.getInt("tier_level"),
                        Math.toIntExact(resultSet.getLong("total_focus_seconds"))))
                .stream()
                .findFirst();
    }

    /**
     * 정산용 활성 유저 집계 페이지. 순위와 무관하게 user.id 오름차순 커서로 페이지 경계를 고정한다.
     */
    public List<LeagueRankingRow> findWeeklyTotalsForSettlement(LocalDate fromDate, LocalDate toDate,
                                                                 UUID cursorExclusive, int limit) {
        validateRange(fromDate, toDate);
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be positive");
        }

        String cursorCondition = cursorExclusive == null ? "" : " AND u.id > :cursorExclusive\n";
        String sql = WEEKLY_TOTALS + cursorCondition + GROUP_BY_USER + " ORDER BY u.id ASC LIMIT :limit";
        MapSqlParameterSource parameters = rangeParameters(fromDate, toDate)
                .addValue("limit", limit);
        if (cursorExclusive != null) {
            parameters.addValue("cursorExclusive", cursorExclusive);
        }
        return jdbcTemplate.query(sql, parameters, this::mapRankingRow);
    }

    /**
     * 지정 유저들만의 정산용 집계 (GROMO-1239 재개 시 userIds 지정 경로). 기존 정산 쿼리의 골격
     * (WEEKLY_TOTALS — 활성·비게스트 필터 포함)을 그대로 재사용하고 id IN 필터만 더한다.
     * 탈퇴/게스트 유저를 지정하면 결과에서 조용히 빠진다 — 정산 대상이 아니기 때문이다.
     */
    public List<LeagueRankingRow> findWeeklyTotalsForUsers(LocalDate fromDate, LocalDate toDate,
                                                            Collection<UUID> userIds) {
        validateRange(fromDate, toDate);
        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        String sql = WEEKLY_TOTALS + " AND u.id IN (:userIds)\n" + GROUP_BY_USER + " ORDER BY u.id ASC";
        MapSqlParameterSource parameters = rangeParameters(fromDate, toDate)
                .addValue("userIds", List.copyOf(userIds));
        return jdbcTemplate.query(sql, parameters, this::mapRankingRow);
    }

    private MapSqlParameterSource rangeParameters(LocalDate fromDate, LocalDate toDate) {
        return new MapSqlParameterSource()
                .addValue("fromDate", fromDate)
                .addValue("toDate", toDate);
    }

    private LeagueRankingRow mapRankingRow(ResultSet resultSet, int rowNumber) throws SQLException {
        return new LeagueRankingRow(
                resultSet.getObject("user_id", UUID.class),
                resultSet.getString("nickname"),
                resultSet.getInt("tier_level"),
                Math.toIntExact(resultSet.getLong("total_focus_seconds")));
    }

    private void validateRange(LocalDate fromDate, LocalDate toDate) {
        if (fromDate == null || toDate == null || fromDate.isAfter(toDate)) {
            throw new IllegalArgumentException("invalid date range");
        }
    }
}

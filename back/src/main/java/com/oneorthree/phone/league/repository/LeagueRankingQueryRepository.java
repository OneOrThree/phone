package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.league.domain.LeagueRankingPosition;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.user.domain.Occupation;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** DailyFocusStat을 단일 점수 원천으로 사용하는 전역 리그 조회 repository. */
@Repository
@RequiredArgsConstructor
public class LeagueRankingQueryRepository {

    // 리그 모수 = 온보딩 완주 유저 (GROMO-1508). 서버가 가진 완주 신호는 nickname 존재가 유일하다
    // (닉네임이 온보딩 마지막 스텝, 게스트도 같은 경로). is_guest 기준은 게스트 완주자를 배제하고
    // 온보딩 이탈한 소셜 유저(nickname = null)를 이름 없는 행으로 편입시켜 양쪽이 틀렸다.
    // 빈 문자열·공백-only 까지 거르는 이유: GROMO-1215 이전 PATCH 경로는 "" 를 그대로 저장했고
    // 그 레거시 행을 정리한 마이그레이션이 없다. NULL 만 걸러선 같은 이름 없는 행이 그대로 남는다.
    // 판정을 btrim 이 아니라 POSIX 문자클래스로 하는 이유(코드리뷰 반영): 인자 없는 btrim 은 ASCII
    // 공백만 떼서 U+2003 같은 유니코드 공백-only 닉네임을 통과시키는데, Java 쪽 getMyTier 는
    // isBlank() 로 같은 값을 걸러 "티어는 미배정인데 랭킹엔 뜨는" 불일치가 생긴다. '[^[:space:]]'
    // (= 공백 아닌 문자 1자 이상)는 유니코드 공백·탭·NBSP 경계까지 isBlank() 와 판정이 같다.
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
               AND u.nickname IS NOT NULL
               AND u.nickname ~ '[^[:space:]]'
            """;

    private static final String GROUP_BY_USER = """
             GROUP BY u.id, u.nickname, u.tier_level
            """;

    // ── 진행 중 세션 경과분 (정렬 전용) ───────────────────────────────────────────────────
    // daily_focus_stats 는 세션이 **끝나야** 갱신된다(FocusService.recordCompletion). 그런데 앱은
    // 랭킹 행에 `totalFocusSeconds + (now − focusStartedAt)` 을 매초 그린다(LiveFocusTime).
    // 그래서 종전엔 집중하는 동안 화면의 시간만 자라고 순위는 얼어붙어, 같은 화면 안에서
    // "시간은 위인데 순위는 아래"가 나왔다. 정렬 키에 그 경과분을 더해 두 값의 순서를 일치시킨다.
    //
    // ⚠️ 응답의 total_focus_seconds 는 **확정 집계 그대로** 둔다 — 여기에 경과분을 실으면 앱이
    // 같은 구간을 한 번 더 더해 이중 계상된다. 라이브는 **정렬·순위 비교에만** 쓴다.
    //
    // ⚠️ 정산 쿼리(findWeeklyTotalsForSettlement/Resume/ForUsers)와 알림용 keyset 페이지
    // (findGlobalRankingPage)는 손대지 않는다. 정산은 확정값이 기준이어야 하고, keyset 커서는
    // 페이지 사이에 계속 변하는 값으로 정렬하면 행이 건너뛰거나 중복된다.
    private static final Duration LIVE_SESSION_MAX_AGE = Duration.ofHours(12);

    // 유저당 최신 미종료 세션 1건. started_at 하한(now − 12h)으로 스윕 전 orphan(버려진 미종료)
    // 세션을 제외한다 — FocusLiveInfoLookup.LIVE_SESSION_MAX_AGE(=앱의 '집중 중' 표시 기준)와 같은 값이라
    // 순위와 표시가 같은 세션 집합을 본다. 부분 인덱스 idx_focus_sessions_live_marker(V47)를 그대로 탄다.
    private static final String LIVE_SESSIONS = """
            SELECT DISTINCT ON (user_id) user_id, started_at
              FROM focus_sessions
             WHERE ended_at IS NULL
               AND started_at >= :liveSince
             ORDER BY user_id, started_at DESC
            """;

    // 라이브 기준 시각(앵커). 주 경계를 걸친 세션(일요일 밤 시작 → 월요일 진행 중)은 주 시작으로
    // 클램프한다 — 지난 주 몫이 이번 주 순위에 실리면 안 된다.
    //
    // ⚠️ NULL 분기를 COALESCE 가 아니라 CASE 로 하는 이유: Postgres 의 GREATEST/LEAST 는 대부분의
    // 함수와 달리 **NULL 인자를 그냥 건너뛴다**. 진행 중 세션이 없어 live.started_at 이 NULL 이면
    // GREATEST(NULL, :weekStartAt) 가 NULL 이 아니라 :weekStartAt 을 돌려줘서, 집중하지도 않은
    // 유저 전원에게 '주 시작부터 지금까지' 가 통째로 붙는다(= 라이브 유저가 오히려 밀린다).
    private static final String LIVE_ANCHOR = """
            CASE WHEN live.started_at IS NULL THEN NULL
                 ELSE GREATEST(live.started_at, :weekStartAt)
            END""";

    // 라이브 경과 초 = now − 앵커. GREATEST(0, ...)는 시계 오차로 앵커가 now 를 아주 살짝 앞설 때의
    // 음수 방어. 앵커가 NULL(미집중)이면 0.
    //
    // ⚠️ 이 값과 앵커는 반드시 **한 쿼리에서 함께** 나와야 한다(코드리뷰 반영). 정렬은 이 경과로
    // 하는데 응답의 focusStartedAt 을 뒤이은 별도 조회에서 다시 읽으면, 두 조회 사이에 세션이
    // 시작·종료된 유저가 "순위는 라이브 기준인데 표시는 확정값"인 채로 한 응답에 섞인다.
    // findTop 이 앵커를 같이 돌려주고 LeagueService 가 그걸 그대로 응답에 싣는 이유다.
    private static final String LIVE_SECONDS = """
            CASE WHEN live.started_at IS NULL THEN 0
                 ELSE GREATEST(0, EXTRACT(EPOCH FROM :now - GREATEST(live.started_at, :weekStartAt)))
            END""";

    private final NamedParameterJdbcTemplate jdbcTemplate;

    /**
     * 상위 limit 명. 정렬은 <b>확정 집계 + 진행 중 세션 경과</b> 기준이고(LIVE_SECONDS 주석),
     * 반환하는 totalFocusSeconds 는 확정 집계 그대로다.
     *
     * @param now 라이브 경과 산정 기준 시각(호출측이 한 요청 안에서 같은 값을 쓴다)
     */
    public List<LeagueRankingRow> findTop(LocalDate fromDate, LocalDate toDate,
                                           Occupation occupation, int limit, Instant now) {
        validateRange(fromDate, toDate);
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be positive");
        }

        String occupationCondition = occupation == null ? "" : " AND u.occupation = :occupation\n";
        String sql = "SELECT t.user_id, t.nickname, t.tier_level, t.total_focus_seconds,"
                + " " + LIVE_ANCHOR + " AS live_started_at FROM ("
                + WEEKLY_TOTALS + occupationCondition + GROUP_BY_USER + ") t"
                + " LEFT JOIN (" + LIVE_SESSIONS + ") live ON live.user_id = t.user_id"
                + " ORDER BY t.total_focus_seconds + " + LIVE_SECONDS + " DESC, t.user_id ASC"
                + " LIMIT :limit";
        MapSqlParameterSource parameters = liveParameters(fromDate, toDate, now)
                .addValue("limit", limit);
        if (occupation != null) {
            parameters.addValue("occupation", occupation.name());
        }
        return jdbcTemplate.query(sql, parameters, this::mapRankingRowWithLiveAnchor);
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

    /**
     * 내 순위. {@link #findTop} 과 <b>같은 정렬 기준</b>(확정 집계 + 진행 중 세션 경과)으로 앞선
     * 유저 수를 세고, 반환하는 totalFocusSeconds 는 확정 집계 그대로다.
     *
     * @param now 라이브 경과 산정 기준 시각
     */
    public Optional<LeagueRankingPosition> findRankOf(UUID userId, LocalDate fromDate, LocalDate toDate,
                                                       Instant now) {
        validateRange(fromDate, toDate);
        String sql = "WITH live AS (" + LIVE_SESSIONS + "), target AS ("
                + WEEKLY_TOTALS + " AND u.id = :userId\n" + GROUP_BY_USER
                + "), target_ranked AS ("
                + " SELECT t.user_id, t.tier_level, t.total_focus_seconds,"
                + " t.total_focus_seconds + " + LIVE_SECONDS + " AS ranking_seconds"
                + " FROM target t LEFT JOIN live ON live.user_id = t.user_id"
                + "), higher_ranked AS ("
                + " SELECT COUNT(*) AS user_count FROM ("
                + " SELECT u.id FROM users u"
                + " LEFT JOIN daily_focus_stats d ON d.user_id = u.id"
                + " AND d.date BETWEEN :fromDate AND :toDate"
                + " LEFT JOIN live ON live.user_id = u.id"
                + " CROSS JOIN target_ranked t"
                + " WHERE u.is_deleted = false AND u.nickname IS NOT NULL"
                + " AND u.nickname ~ '[^[:space:]]'"
                // live.started_at 은 HAVING 에서 쓰므로 그룹 키에 있어야 한다(유저당 1행이라 그룹은 안 쪼개진다).
                + " GROUP BY u.id, live.started_at, t.user_id, t.ranking_seconds"
                + " HAVING COALESCE(SUM(d.total_focus_seconds), 0) + " + LIVE_SECONDS
                + " > t.ranking_seconds"
                + " OR (COALESCE(SUM(d.total_focus_seconds), 0) + " + LIVE_SECONDS
                + " = t.ranking_seconds AND u.id < t.user_id)"
                + " ) preceding_users)"
                + " SELECT higher_ranked.user_count + 1 AS ranking_position,"
                + " target_ranked.tier_level, target_ranked.total_focus_seconds"
                + " FROM target_ranked CROSS JOIN higher_ranked";
        MapSqlParameterSource parameters = liveParameters(fromDate, toDate, now)
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

    // 재개(resume) 전용 가입 컷오프 술어 (GROMO-1239) — 정산 대상 주차가 끝난 뒤(경계 이후) 가입한
    // 유저는 그 주차에 존재하지 않았으므로 0초 STAY 결과가 조작되면 안 된다. created_at 이 NULL 인
    // 레거시 행은 경계 이전 존재로 간주해 포함한다(초기 데이터 — 컷오프로 새로 배제할 근거가 없다).
    private static final String CREATED_BEFORE_CONDITION =
            " AND (u.created_at IS NULL OR u.created_at < :createdBefore)\n";

    /**
     * 재개(resume) 전용 정산 집계 페이지 (GROMO-1239) — {@link #findWeeklyTotalsForSettlement} 와
     * 같은 골격에 가입 컷오프({@code createdBefore} = 정산 주차 종료 경계)만 더한 변형이다.
     * 스케줄 run 이 쓰는 원본 쿼리는 바이트 단위로 건드리지 않는다.
     */
    public List<LeagueRankingRow> findWeeklyTotalsForResume(LocalDate fromDate, LocalDate toDate,
                                                             UUID cursorExclusive, int limit,
                                                             Instant createdBefore) {
        validateRange(fromDate, toDate);
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be positive");
        }
        if (createdBefore == null) {
            throw new IllegalArgumentException("createdBefore must not be null");
        }

        String cursorCondition = cursorExclusive == null ? "" : " AND u.id > :cursorExclusive\n";
        String sql = WEEKLY_TOTALS + cursorCondition + CREATED_BEFORE_CONDITION + GROUP_BY_USER
                + " ORDER BY u.id ASC LIMIT :limit";
        MapSqlParameterSource parameters = rangeParameters(fromDate, toDate)
                .addValue("limit", limit)
                .addValue("createdBefore", Timestamp.from(createdBefore));
        if (cursorExclusive != null) {
            parameters.addValue("cursorExclusive", cursorExclusive);
        }
        return jdbcTemplate.query(sql, parameters, this::mapRankingRow);
    }

    /**
     * 지정 유저들만의 정산용 집계 (GROMO-1239 재개 시 userIds 지정 경로). 기존 정산 쿼리의 골격
     * (WEEKLY_TOTALS — 활성·온보딩 완주 필터 포함)을 그대로 재사용하고 id IN 필터와 가입 컷오프만
     * 더한다. 탈퇴/온보딩 미완주/경계 이후 가입 유저를 지정하면 결과에서 조용히 빠진다 — 정산 대상이
     * 아니기 때문이다.
     */
    public List<LeagueRankingRow> findWeeklyTotalsForUsers(LocalDate fromDate, LocalDate toDate,
                                                            Collection<UUID> userIds,
                                                            Instant createdBefore) {
        validateRange(fromDate, toDate);
        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        if (createdBefore == null) {
            throw new IllegalArgumentException("createdBefore must not be null");
        }
        String sql = WEEKLY_TOTALS + " AND u.id IN (:userIds)\n" + CREATED_BEFORE_CONDITION
                + GROUP_BY_USER + " ORDER BY u.id ASC";
        MapSqlParameterSource parameters = rangeParameters(fromDate, toDate)
                .addValue("userIds", List.copyOf(userIds))
                .addValue("createdBefore", Timestamp.from(createdBefore));
        return jdbcTemplate.query(sql, parameters, this::mapRankingRow);
    }

    /**
     * 라이브 정렬 파라미터를 더한 범위 파라미터. weekStartAt(=fromDate 의 KST 자정)은 주 경계를
     * 걸친 진행 중 세션의 클램프 하한이다.
     *
     * <p>세 값을 {@link OffsetDateTime} 으로 바인딩하는 이유: 비교 상대(focus_sessions.started_at)가
     * timestamptz 라, java.sql.Timestamp 로 넘기면 JVM 기본 존과 DB 세션 존이 어긋날 때 값이 밀린다.
     */
    private MapSqlParameterSource liveParameters(LocalDate fromDate, LocalDate toDate, Instant now) {
        if (now == null) {
            throw new IllegalArgumentException("now must not be null");
        }
        return rangeParameters(fromDate, toDate)
                .addValue("now", now.atOffset(ZoneOffset.UTC))
                .addValue("weekStartAt", fromDate.atStartOfDay(ZonePolicy.KST).toOffsetDateTime())
                .addValue("liveSince", now.minus(LIVE_SESSION_MAX_AGE).atOffset(ZoneOffset.UTC));
    }

    private MapSqlParameterSource rangeParameters(LocalDate fromDate, LocalDate toDate) {
        return new MapSqlParameterSource()
                .addValue("fromDate", fromDate)
                .addValue("toDate", toDate);
    }

    /**
     * {@link #findTop} 전용 매퍼 — 정렬에 쓴 라이브 앵커까지 담는다. 다른 조회는 이 컬럼을
     * SELECT 하지 않으므로 {@link #mapRankingRow}(앵커 null)를 쓴다.
     */
    private LeagueRankingRow mapRankingRowWithLiveAnchor(ResultSet resultSet, int rowNumber) throws SQLException {
        Timestamp liveStartedAt = resultSet.getTimestamp("live_started_at");
        return new LeagueRankingRow(
                resultSet.getObject("user_id", UUID.class),
                resultSet.getString("nickname"),
                resultSet.getInt("tier_level"),
                Math.toIntExact(resultSet.getLong("total_focus_seconds")),
                liveStartedAt == null ? null : liveStartedAt.toInstant());
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

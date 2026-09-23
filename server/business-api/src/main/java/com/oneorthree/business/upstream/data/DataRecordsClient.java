package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.IslandFishEarnings;
import com.oneorthree.business.upstream.data.dto.IslandLedger;
import com.oneorthree.business.upstream.data.dto.IslandRankingViews;
import com.oneorthree.business.upstream.data.dto.IslandRecordViews;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.time.LocalDate;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.islandPath;
import static com.oneorthree.business.upstream.data.DataPaths.sessionScoped;
import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/** 회관 기록·공동 가계부·주간 랭킹·기기 측정의 Data 호출 (GROMO-1769 · GROMO-1895 · GROMO-1997). */
public class DataRecordsClient {

    // GROMO-1769 회관 기록 3종 — 조회 2 는 섬 축, 측정 PUT 은 본인 명령이라 사용자 축(B26).
    private static final String PATH_FOCUS_STATISTICS = "/internal/islands/{islandId}/statistics/focus";
    private static final String PATH_SCREEN_TIME_STATISTICS = "/internal/islands/{islandId}/statistics/screen-time";
    // GROMO-1895 섬 공동 가계부 — 회관 화면과 도메인 GET 이 같이 쓰는 섬 축 조회다(B26).
    private static final String PATH_ISLAND_LEDGER = "/internal/islands/{islandId}/resources/ledger";
    // GROMO-1895 도서관 물고기 장 — 다른 도서관 통계와 같은 statistics/ 아래 섬 축 조회다(B26).
    private static final String PATH_FISH_EARNINGS = "/internal/islands/{islandId}/statistics/fish-earnings";
    // GROMO-1997 주간 섬 랭킹 — 경로 섬이 없는 «전체 섬» 순위라 주체 축이다(B26).
    private static final String PATH_ISLAND_RANKINGS = "/internal/users/{userId}/island-rankings";

    private final InternalHttpClient http;

    public DataRecordsClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 집중 통계 (GROMO-1769). 멱등 GET 이라 재시도한다. 다음 페이지 경계(스냅샷 id·offset)는 Business 가 서명 커서에서
     * 꺼낸 평문이다.
     */
    public IslandRecordViews.FocusStatistics fetchFocusStatistics(UUID userId, UUID islandId, LocalDate from,
            LocalDate to, String scope, UUID snapshotId, Integer offset, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_FOCUS_STATISTICS, islandId))
                        .onBehalfOf(userId)
                        .query("from", from.toString())
                        .query("to", to.toString())
                        .query("scope", scope)
                        .query("snapshotId", snapshotId == null ? null : snapshotId.toString())
                        .query("offset", offset == null ? null : offset.toString())
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRecordViews.FocusStatistics>() { });
    }

    /**
     * 섬 공동 가계부 한 쪽 (GROMO-1895). 멱등 GET 이라 재시도한다. {@code month} 는 KST 달력 월
     * ({@code YYYY-MM}), 경계는 평문 keyset({@code afterCreatedAt}+{@code afterEntryId} 둘 다 또는 둘 다 없음)이다.
     */
    public IslandLedger fetchIslandLedger(UUID userId, UUID islandId, String month, String direction,
            Instant afterCreatedAt, UUID afterEntryId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_LEDGER, islandId))
                        .onBehalfOf(userId)
                        .query("month", month)
                        .query("direction", direction)
                        .query("afterCreatedAt", afterCreatedAt == null ? null : afterCreatedAt.toString())
                        .query("afterEntryId", afterEntryId == null ? null : afterEntryId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandLedger>() { });
    }

    /**
     * 도서관 물고기 장 — 주민별 누적 획득 (GROMO-1895). 멱등 GET 이라 재시도한다. query 가 없다 —
     * 기간도 페이지도 고를 수 없는 「이 섬 전 기간」 집계다.
     */
    public IslandFishEarnings fetchFishEarnings(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_FISH_EARNINGS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandFishEarnings>() { });
    }

    /** 스크린타임 통계 (GROMO-1769). 멱등 GET 이라 재시도한다. */
    public IslandRecordViews.ScreenTimeStatistics fetchScreenTimeStatistics(UUID userId, UUID islandId,
            LocalDate from, LocalDate to, String scope, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SCREEN_TIME_STATISTICS, islandId))
                        .onBehalfOf(userId)
                        .query("from", from.toString())
                        .query("to", to.toString())
                        .query("scope", scope)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRecordViews.ScreenTimeStatistics>() { });
    }

    /**
     * 주간 섬 랭킹 (GROMO-1997). 멱등 GET 이라 재시도한다. {@code week} 는 주 시작일(UTC 일요일)이고, 전망대·주민
     * 판정과 달력 의미(일요일인가·아직 오지 않은 주인가)는 Data 가 한다.
     */
    public IslandRankingViews.IslandRankingPage fetchIslandRankings(UUID userId, LocalDate week, Integer limit,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_ISLAND_RANKINGS, userId))
                        .onBehalfOf(userId)
                        .query("week", week.toString())
                        .query("limit", limit == null ? null : limit.toString())
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRankingViews.IslandRankingPage>() { });
    }

    /**
     * 기기 측정 PUT (GROMO-1769). 앱 키를 그대로 Data 의 공개 명령 receipt 에 전달하고, 세션·세대는 서명된 AT 에서만
     * 가져온다 — 측정 기기 = 이 세션인지는 Data 가 판정한다.
     */
    public IslandRecordViews.ScreenTimeDay putScreenTime(UUID userId, UUID sessionId, long generation,
            LocalDate date, Map<String, Object> body, UUID key, Deadline deadline) {
        return http.exchange(
                sessionScoped(HttpMethod.PUT, "/internal/users/" + userId + "/screen-time/" + date,
                        userId, sessionId, generation)
                        .idempotencyKey(key.toString())
                        .body(body)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRecordViews.ScreenTimeDay>() { });
    }
}

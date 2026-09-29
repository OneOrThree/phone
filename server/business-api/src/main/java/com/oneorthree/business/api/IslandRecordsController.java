package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.IslandRecordsResponses.FishEarningsView;
import com.oneorthree.business.api.dto.IslandRecordsResponses.ScreenTimeDayView;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandRecordsUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 회관 기록(도서관)의 공개 표면 — 통계 3종(GROMO-1769, island-records LLD §1·§2·§4)에 공동 가계부
 * (GROMO-1786)와 주민별 누적 물고기(GROMO-2046, LLD §7)가 얹혀 있다.
 *
 * <p>{@code /islands/**}·{@code /me/**} 는 {@code PublicApiRoutes.ROOTS} 에 있어 봉투와 {@code no-store} 가 붙는다.
 * 주체는 strict 세션에서만 온다. 여기서 보는 것은 <b>모양</b>이다 — query·본문의 허용 키, 타입, 날짜 형식과 실재,
 * 31일 상한, scope·timezone 값. 주민·도서관·기기·측정 창 판정은 Data 몫이다.
 *
 * <p><b>날짜 축은 UTC 다</b>(2026-09-19 결정 RC-축). {@code timezone} 은 생략하거나 정확히 {@code "UTC"} 만 받는다 —
 * {@code Asia/Seoul} 은 같은 날짜를 다른 축으로 읽게 만들어 400 이다(섬 퀘스트 Q-6 과 같은 규칙).
 */
@RestController
@RequiredArgsConstructor
public class IslandRecordsController {

    private static final Set<String> FOCUS_QUERY = Set.of("from", "to", "timezone", "scope", "cursor");
    private static final Set<String> SCREEN_QUERY = Set.of("from", "to", "timezone", "scope");
    private static final Set<String> LEDGER_QUERY = Set.of("month", "direction", "cursor");
    private static final Set<String> DIRECTIONS = Set.of("earn", "spend");
    private static final Set<String> UPLOAD_KEYS = Set.of("minutes", "measurementStatus", "timezone",
            "measuredAt", "deviceId");
    private static final Set<String> SCOPES = Set.of(IslandRecordsUseCase.SCOPE_ME, IslandRecordsUseCase.SCOPE_ISLAND);
    private static final Set<String> STATUSES = Set.of("authorized", "denied", "unavailable", "pending");
    private static final String UTC = "UTC";
    /** 조회 기간 상한(양끝 포함) — Data 와 같다. */
    private static final int MAX_DAYS = 31;
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern MONTH = Pattern.compile("\\d{4}-\\d{2}");
    private static final DateTimeFormatter STRICT_DATE =
            DateTimeFormatter.ofPattern("uuuu-MM-dd").withResolverStyle(ResolverStyle.STRICT);
    private static final DateTimeFormatter STRICT_MONTH =
            DateTimeFormatter.ofPattern("uuuu-MM").withResolverStyle(ResolverStyle.STRICT);

    private final IslandRecordsUseCase records;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 집중 통계 — scope 별 모양은 LLD §2 표. {@code cursor} 는 scope=me 의 기록 페이지만 잇는다. */
    @GetMapping("/islands/{islandId}/statistics/focus")
    public Object focus(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        Query query = query(request, FOCUS_QUERY);
        return records.focus(claims, islandId(islandId), query.from(), query.to(), query.scope(),
                request.getParameter("cursor"), properties.deadline());
    }

    /** 스크린타임 통계 — 원본 계약에 커서가 없어 목록을 자르지 않는다. */
    @GetMapping("/islands/{islandId}/statistics/screen-time")
    public Object screenTime(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        Query query = query(request, SCREEN_QUERY);
        return records.screenTime(claims, islandId(islandId), query.from(), query.to(), query.scope(),
                properties.deadline());
    }

    /**
     * 공동 가계부 (GROMO-1786, island-construction LLD §6) — 회관에서 읽는 섬 원장이다.
     *
     * <p>{@code month} 는 필수 {@code YYYY-MM} 이고 <b>축은 KST 달력 월</b>이다 — 통계 3종의 UTC 날짜 축과
     * 다르지만 여기서 만든 규칙이 아니라 Data 의 {@code ZonePolicy.KST} 를 따라간다(date-axis 규약 §2:
     * UTC 컷오버 전까지 KST 가 현행). {@code timezone} 은 받지 않는다 — 고를 수 있는 축이 아니다.
     *
     * <p>{@code direction} 은 {@code earn|spend} 만, {@code limit} 은 공개 query 가 아니다(서버 내부 30).
     */
    @GetMapping("/islands/{islandId}/resources/ledger")
    public IslandRecordsUseCase.Ledger ledger(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        request.getParameterMap().forEach((name, values) -> {
            if (!LEDGER_QUERY.contains(name) || values.length != 1) {
                throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
            }
        });
        String direction = request.getParameter("direction");
        if (direction != null && !DIRECTIONS.contains(direction)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "direction");
        }
        return records.ledger(claims, islandId(islandId), month(required(request, "month")), direction,
                request.getParameter("cursor"), properties.deadline());
    }

    /**
     * 도서관 물고기 장 — 주민별 누적 획득 (GROMO-2046, island-records LLD §7).
     *
     * <p><b>query 가 없다</b> — 기간도 scope 도 페이지도 고를 수 없는 「이 섬 전 기간, 활성 주민 전원」 집계다
     * (섬 정원 상한 안이라 페이지가 없다). 그래서 뭐라도 붙어 오면 400 이다: 모르는 키를 조용히 버리면 앱이
     * {@code ?from=} 을 붙여 놓고 기간이 걸린 줄 안다.
     *
     * <p>주민·도서관 완공 판정은 Data 몫이다 — 방문자는 403 {@code FORBIDDEN}, 미완공은 403
     * {@code FACILITY_LOCKED} 이고 둘 다 빈 명단이 아니다.
     */
    @GetMapping("/islands/{islandId}/statistics/fish-earnings")
    public FishEarningsView fishEarnings(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (!request.getParameterMap().isEmpty()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER,
                    request.getParameterMap().keySet().iterator().next());
        }
        return records.fishEarnings(claims, islandId(islandId), properties.deadline());
    }

    /**
     * 기기 측정 PUT (LLD §4). {@code Idempotency-Key} 필수. {@code minutes} 는 authorized 면 0 이상 정수, 나머지 상태는
     * 명시 null 이다 — 결측을 0 으로 지어내지 않는다(RC-P06).
     */
    @PutMapping(value = "/me/screen-time/{date}", consumes = "application/json")
    public ScreenTimeDayView putScreenTime(@PathVariable String date, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (!request.getParameterMap().isEmpty()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER,
                    request.getParameterMap().keySet().iterator().next());
        }
        UUID key = CommandKeys.required(request);
        LocalDate day = date(date, "date");
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        for (String name : body.propertyNames()) {
            if (!UPLOAD_KEYS.contains(name)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
            }
        }
        String status = text(body, "measurementStatus");
        if (!STATUSES.contains(status)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "measurementStatus");
        }
        Integer minutes = minutes(body, "authorized".equals(status));
        JsonNode timezone = body.get("timezone");
        if (timezone != null && !(timezone.isString() && UTC.equals(timezone.stringValue()))) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "timezone");
        }
        Instant measuredAt;
        try {
            measuredAt = Instant.parse(text(body, "measuredAt"));
        } catch (DateTimeParseException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "measuredAt");
        }
        UUID deviceId = PublicIds.uuid(text(body, "deviceId"), "deviceId", ApiErrorCode.INVALID_REQUEST);
        Map<String, Object> command = new LinkedHashMap<>();
        command.put("minutes", minutes);
        command.put("measurementStatus", status);
        command.put("timezone", UTC);
        // timestamptz 정밀도(마이크로초)로 맞춰 보낸다 — Data 가 저장한 시각과 같은 값으로 비교한다.
        command.put("measuredAt", measuredAt.truncatedTo(ChronoUnit.MICROS).toString());
        command.put("deviceId", deviceId.toString());
        return records.putScreenTime(claims, day, command, key, properties.deadline());
    }

    // ---------------------------------------------------------------- 입력 해석

    /** 허용 키만, 키마다 값 하나. 기간은 양끝 포함 31일 이내, scope 는 me|island. */
    private static Query query(HttpServletRequest request, Set<String> allowed) {
        request.getParameterMap().forEach((name, values) -> {
            if (!allowed.contains(name) || values.length != 1) {
                throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
            }
        });
        LocalDate from = date(required(request, "from"), "from");
        LocalDate to = date(required(request, "to"), "to");
        if (from.isAfter(to)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "from");
        }
        if (from.plusDays(MAX_DAYS - 1L).isBefore(to)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "to");
        }
        String timezone = request.getParameter("timezone");
        if (timezone != null && !UTC.equals(timezone)) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "timezone");
        }
        String scope = required(request, "scope");
        if (!SCOPES.contains(scope)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "scope");
        }
        return new Query(from, to, scope);
    }

    private static String required(HttpServletRequest request, String name) {
        String value = request.getParameter(name);
        if (value == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
        }
        return value;
    }

    /** {@code YYYY-MM-DD} 가 아니면 400, 모양은 맞는데 없는 날짜(2월 30일)면 422 다(LLD §2). */
    private static LocalDate date(String value, String field) {
        if (!DATE.matcher(value).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
        try {
            return LocalDate.parse(value, STRICT_DATE);
        } catch (DateTimeParseException e) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
    }

    /**
     * {@code YYYY-MM} 이 아니면 400, 모양은 맞는데 없는 달(13월)이면 422 다 — 날짜와 같은 규칙이다.
     * 값은 Data 가 그대로 되돌려 주므로 정규화한 문자열로 넘긴다.
     */
    private static String month(String value) {
        if (!MONTH.matcher(value).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "month");
        }
        try {
            return YearMonth.parse(value, STRICT_MONTH).toString();
        } catch (DateTimeParseException e) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "month");
        }
    }

    /** 필수 문자열 — 없거나 명시 null·다른 타입이면 400. */
    private static String text(JsonNode body, String field) {
        JsonNode node = body.get(field);
        if (node == null || !node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        return node.stringValue();
    }

    /** authorized 면 0~1440 정수(소수·문자열·boolean 400, 범위 밖 422), 아니면 명시 null 만. */
    private static Integer minutes(JsonNode body, boolean authorized) {
        JsonNode node = body.get("minutes");
        if (node == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "minutes");
        }
        if (!authorized) {
            if (!node.isNull()) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "minutes");
            }
            return null;
        }
        if (!node.isIntegralNumber()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "minutes");
        }
        if (!node.canConvertToInt() || node.intValue() < 0 || node.intValue() > 1440) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "minutes");
        }
        return node.intValue();
    }

    private static UUID islandId(String value) {
        return PublicIds.uuid(value, "islandId");
    }

    private record Query(LocalDate from, LocalDate to, String scope) {
    }
}

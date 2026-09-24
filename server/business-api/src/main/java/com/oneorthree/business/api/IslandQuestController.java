package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.QuestResponses.CurrentQuestsView;
import com.oneorthree.business.api.dto.QuestResponses.IslandQuestClaimed;
import com.oneorthree.business.api.dto.QuestResponses.IslandQuestCreated;
import com.oneorthree.business.api.dto.QuestResponses.IslandQuestProgressView;
import com.oneorthree.business.api.dto.QuestResponses.IslandQuestUpdated;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.DataQuestClient;
import com.oneorthree.business.usecase.IslandQuestUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 섬 퀘스트 5종의 공개 표면 (GROMO-1773, island-quests LLD §1·§2).
 *
 * <p>{@code /islands/**} 는 {@code PublicApiRoutes.ROOTS} 에 있어 봉투가 자동으로 씌워진다. 생성·수정·claim 은
 * {@code Idempotency-Key}(UUID36)가 필수이고 claim 만 {@code expectedVersion} 을 받는다(Q08). 주체는 strict
 * 세션에서만 오고, 사용자 ID·권한·claimable·지급량 입력은 받지 않는다(LLD §2).
 *
 * <p>여기서 보는 것은 <b>모양</b>이다 — JSON 객체·허용 키·타입·명시 null·UUID/HH:mm 형식·timezone 값. 길이·
 * 목표·창의 <b>범위</b>(422)는 Data 가 한 곳에서 판정한다.
 */
@RestController
@RequiredArgsConstructor
public class IslandQuestController {

    private static final Set<String> CREATE_KEYS =
            Set.of("title", "type", "targetMinutes", "windowStart", "windowEnd", "timezone");
    private static final Set<String> UPDATE_KEYS = Set.of("title", "targetMinutes");
    private static final Set<String> TYPES = Set.of("focus", "screen");
    private static final String UTC = "UTC";
    private static final Pattern HH_MM = Pattern.compile("\\d{2}:\\d{2}");
    private static final DateTimeFormatter WINDOW =
            DateTimeFormatter.ofPattern("HH:mm").withResolverStyle(ResolverStyle.STRICT);

    private final IslandQuestUseCase quests;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 현재 회차 목록 (LLD quests). 질의가 없다. */
    @GetMapping("/islands/{islandId}/quests/current")
    public CurrentQuestsView current(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return quests.current(claims, uuid(islandId, "islandId", ApiErrorCode.INVALID_PARAMETER), deadline());
    }

    /**
     * 회차 진행 (LLD quest). {@code occurrenceId} 필수. 섬 정원(최대 15)이 페이지 크기(30)보다 작아 첫 페이지가
     * 전부라 서버는 커서를 발급하지 않는다 — 그래서 들어온 {@code cursor} 는 무엇이든 위조로 본다(400).
     */
    @GetMapping("/islands/{islandId}/quests/{questId}/progress")
    public IslandQuestProgressView progress(@PathVariable String islandId, @PathVariable String questId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (request.getParameterValues("cursor") != null) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
        String[] occurrence = request.getParameterValues("occurrenceId");
        if (occurrence == null || occurrence.length != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "occurrenceId");
        }
        return quests.progress(claims, uuid(islandId, "islandId", ApiErrorCode.INVALID_PARAMETER),
                uuid(questId, "questId", ApiErrorCode.INVALID_PARAMETER),
                uuid(occurrence[0], "occurrenceId", ApiErrorCode.INVALID_PARAMETER), deadline());
    }

    /** 퀘스트 생성 (LLD quest-create) — 방장만. 201 {@code {id,title}}. */
    @PostMapping(value = "/islands/{islandId}/quests", consumes = "application/json")
    public ResponseEntity<IslandQuestCreated> create(@PathVariable String islandId,
            @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        requireKeys(body, CREATE_KEYS);
        String type = string(body, "type");
        if (!TYPES.contains(type)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "type");
        }
        String windowStart = null;
        String windowEnd = null;
        if ("focus".equals(type)) {
            windowStart = window(body, "windowStart");
            windowEnd = window(body, "windowEnd");
        } else if (body.has("windowStart") || body.has("windowEnd")) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST,
                    body.has("windowStart") ? "windowStart" : "windowEnd");
        }
        String timezone = null;
        if (body.has("timezone")) {
            timezone = string(body, "timezone");
            if (!UTC.equals(timezone)) {
                throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "timezone");
            }
        }
        DataQuestClient.QuestCreateCommand command = new DataQuestClient.QuestCreateCommand(string(body, "title"), type,
                integer(body, "targetMinutes"), windowStart, windowEnd, timezone);
        IslandQuestCreated created = quests.create(claims,
                uuid(islandId, "islandId", ApiErrorCode.INVALID_PARAMETER), command, key, deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /** 정의 수정 (LLD quest-edit) — 방장만. title/targetMinutes 중 하나 이상, 생략은 유지·null 은 거절. */
    @PatchMapping(value = "/islands/{islandId}/quests/{questId}", consumes = "application/json")
    public IslandQuestUpdated update(@PathVariable String islandId, @PathVariable String questId,
            @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        requireKeys(body, UPDATE_KEYS);
        if (body.isEmpty()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        String title = body.has("title") ? string(body, "title") : null;
        Integer target = body.has("targetMinutes") ? integer(body, "targetMinutes") : null;
        return quests.update(claims, uuid(islandId, "islandId", ApiErrorCode.INVALID_PARAMETER),
                uuid(questId, "questId", ApiErrorCode.INVALID_PARAMETER), title, target, key, deadline());
    }

    /** 회차 정산 (LLD claim) — 주민 누구나. 본문은 정확히 {occurrenceId, expectedVersion}. */
    @PostMapping(value = "/islands/{islandId}/quests/{questId}/claims", consumes = "application/json")
    public IslandQuestClaimed claim(@PathVariable String islandId, @PathVariable String questId,
            @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.size() != 2) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        UUID occurrenceId = uuid(string(body, "occurrenceId"), "occurrenceId", ApiErrorCode.INVALID_REQUEST);
        long expectedVersion = ResourceVersions.fromJson(body.get("expectedVersion"), "expectedVersion");
        if (expectedVersion < 1) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "expectedVersion");
        }
        return quests.claim(claims, uuid(islandId, "islandId", ApiErrorCode.INVALID_PARAMETER),
                uuid(questId, "questId", ApiErrorCode.INVALID_PARAMETER), occurrenceId, expectedVersion, key,
                deadline());
    }

    // ---------------------------------------------------------------- 입력 해석

    /** JSON 객체이고 허용 키만 있어야 한다 — 모르는 키(새 type·창·반복 키 포함)는 400 이다. */
    private static void requireKeys(JsonNode body, Set<String> allowed) {
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        for (String name : body.propertyNames()) {
            if (!allowed.contains(name)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
            }
        }
    }

    /** 필수 문자열 — 없거나 명시 null·다른 타입이면 400. */
    private static String string(JsonNode body, String field) {
        JsonNode node = body.get(field);
        if (node == null || !node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        return node.stringValue();
    }

    /** 정수 토큰만 — 1.5·"30" 을 절삭·변환하지 않는다. int 를 넘으면 범위 위반이다. */
    private static int integer(JsonNode body, String field) {
        JsonNode node = body.get(field);
        if (node == null || !node.isIntegralNumber()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        if (!node.canConvertToInt()) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
        return node.intValue();
    }

    /** focus 창 — 실재하는 {@code HH:mm}. 시각의 의미 축은 UTC 다(결정 Q-6). */
    private static String window(JsonNode body, String field) {
        String value = string(body, field);
        try {
            if (!HH_MM.matcher(value).matches()) {
                throw new DateTimeParseException("HH:mm", value, 0);
            }
            LocalTime.parse(value, WINDOW);
            return value;
        } catch (DateTimeParseException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
    }

    private static UUID uuid(String value, String field, ApiErrorCode code) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(code, field);
        }
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}

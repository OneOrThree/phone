package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.FocusFinish;
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.FocusSummary;
import com.oneorthree.business.usecase.FocusSessionUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/**
 * 집중 세션 수명주기 6종의 <b>공개 경계</b> (GROMO-1764, focus-rest-session LLD §2).
 *
 * <p>무접두 {@code /focus-sessions}·{@code /me} 는 nginx 가 이 서비스로 보낸다 — data-api 가 같은 경로를
 * 매핑해도 요청이 닿지 않으므로 공개 표면은 여기 하나다. 실제 상태 전이·시간·정산은 Data 의
 * {@code /internal/users/{userId}/…} 가 한 트랜잭션에서 판정한다.
 *
 * <p>주체는 AT 에서만 온다({@link SettingsSessionGuard#requireSession}). 경로·본문에 userId 를 두지
 * 않으므로 「남의 세션」을 가리킬 입력이 없다. 성공 {@code {"data": …}} 봉투는 공통 advice 가 씌운다.
 *
 * <p>요청 URI 의 정확 일치 검사({@code IslandHostTransferController} 가 하는 것)는 두지 않는다 — 여기
 * 경로 변수는 {@link #uuid} 로 canonical UUID 만 통과하고, 그 값이 상류 URL 로 나갈 때는 파싱된 UUID 를
 * 다시 문자열로 만든 것이라 인코딩 장난이 상류 경로에 실릴 자리가 없다.
 */
@RestController
@RequiredArgsConstructor
public class FocusSessionController {

    private final FocusSessionUseCase focusSessions;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @PostMapping(value = "/focus-sessions", consumes = "application/json")
    public ResponseEntity<FocusSessionState> start(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.size() != 3) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode islandId = body.get("islandId");
        JsonNode subject = body.get("subject");
        JsonNode targetMinutes = body.get("targetMinutes");
        if (islandId == null || !islandId.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "islandId");
        }
        if (subject == null || !subject.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "subject");
        }
        // 정수 타입을 «변환 전에» 확인한다(LLD §1) — 1.5 를 1 로 절삭하는 기본 강제변환을 쓰지 않는다.
        if (targetMinutes == null || !targetMinutes.isIntegralNumber() || !targetMinutes.canConvertToInt()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "targetMinutes");
        }
        FocusSessionState started = focusSessions.start(claims, uuid(islandId.stringValue(), "islandId"),
                subject.stringValue(), targetMinutes.intValue(), key, deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(started);
    }

    /** 진행 세션이 없으면 {@code {"data": null}} 이다 — 정상값이고 404 가 아니다(LLD §2 session). */
    @GetMapping("/focus-sessions/current")
    public FocusSessionState current(HttpServletRequest request) {
        return focusSessions.current(sessions.requireSession(request), deadline());
    }

    @PostMapping(value = "/focus-sessions/{sessionId}/pause", consumes = "application/json")
    public FocusSessionState pause(@PathVariable String sessionId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return focusSessions.pause(claims, uuid(sessionId, "sessionId"), expectedVersion(body), key, deadline());
    }

    @PostMapping(value = "/focus-sessions/{sessionId}/resume", consumes = "application/json")
    public FocusSessionState resume(@PathVariable String sessionId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return focusSessions.resume(claims, uuid(sessionId, "sessionId"), expectedVersion(body), key, deadline());
    }

    @PostMapping(value = "/focus-sessions/{sessionId}/finish", consumes = "application/json")
    public FocusFinish finish(@PathVariable String sessionId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return focusSessions.finish(claims, uuid(sessionId, "sessionId"), expectedVersion(body), key, deadline());
    }

    /**
     * {@code date}·{@code timezone} 의 <b>값</b> 판정은 Data 가 한다 — KST 규약을 두 곳에서 해석하지 않는다.
     * 여기서 보는 것은 값이 아니라 <b>개수</b>다({@link #single}).
     */
    @GetMapping("/me/focus-summary")
    public FocusSummary summary(HttpServletRequest request) {
        return focusSessions.summary(sessions.requireSession(request), single(request, "date"),
                single(request, "timezone"), deadline());
    }

    /**
     * 쿼리 파라미터 하나 — 같은 키가 여러 번 오면 400 이다.
     *
     * <p>{@code @RequestParam String} 으로 받으면 다중 값이 첫 값(또는 콤마 결합)으로 조용히 축소돼
     * {@code ?timezone=Asia/Seoul&timezone=UTC} 가 200 으로 통과한다 — 프록시·캐시·앱이 서로 다른 값을
     * 읽고도 서버는 한 값만 판정한 셈이 된다. 모호한 요청은 고르지 말고 거절한다.
     *
     * @return 값이 없으면 {@code null}(둘 다 선택 파라미터다)
     */
    private static String single(HttpServletRequest request, String name) {
        String[] values = request.getParameterValues(name);
        if (values == null || values.length == 0) {
            return null;
        }
        if (values.length > 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
        }
        return values[0];
    }

    /** pause/resume/finish 공용 본문 — expectedVersion 하나만 받는다(FR-P07). */
    private static long expectedVersion(JsonNode body) {
        if (body == null || !body.isObject() || body.size() != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "expectedVersion");
        }
        return ResourceVersions.fromJson(body.get("expectedVersion"), "expectedVersion");
    }

    private static UUID uuid(String value, String field) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}

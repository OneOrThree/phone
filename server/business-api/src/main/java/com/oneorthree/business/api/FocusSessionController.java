package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.FocusSessionUseCase.FinishView;
import com.oneorthree.business.usecase.FocusSessionUseCase.StateView;
import com.oneorthree.business.usecase.FocusSessionUseCase.SummaryView;
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
 * 경로 변수는 {@link PublicIds#uuid} 로 canonical UUID 만 통과하고, 그 값이 상류 URL 로 나갈 때는 파싱된
 * UUID 를 다시 문자열로 만든 것이라 인코딩 장난이 상류 경로에 실릴 자리가 없다.
 */
@RestController
@RequiredArgsConstructor
public class FocusSessionController {

    private final FocusSessionUseCase focusSessions;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @PostMapping(value = "/focus-sessions", consumes = "application/json")
    public ResponseEntity<StateView> start(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        // targetMinutes 는 선택이다(GROMO-1990) — 그래서 필드 «개수»는 2 또는 3 이다. 개수 검사를 놓으면
        // 알 수 없는 필드가 조용히 통과하므로, 3 인데 targetMinutes 가 없으면 그 3번째가 곧 오타다.
        if (body == null || !body.isObject() || body.size() < 2 || body.size() > 3) {
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
        if (body.size() == 3 && targetMinutes == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        boolean absent = targetMinutes == null || targetMinutes.isNull();
        // 정수 타입을 «변환 전에» 확인한다(LLD §1) — 1.5 를 1 로 절삭하는 기본 강제변환을 쓰지 않는다.
        if (!absent && (!targetMinutes.isIntegralNumber() || !targetMinutes.canConvertToInt())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "targetMinutes");
        }
        StateView started = focusSessions.start(claims, PublicIds.uuid(islandId.stringValue(), "islandId"),
                subject.stringValue(), absent ? null : targetMinutes.intValue(), key, properties.deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(started);
    }

    /** 진행 세션이 없으면 {@code {"data": null}} 이다 — 정상값이고 404 가 아니다(LLD §2 session). */
    @GetMapping("/focus-sessions/current")
    public StateView current(HttpServletRequest request) {
        return focusSessions.current(sessions.requireSession(request), properties.deadline());
    }

    /**
     * 휴식이 1시간을 넘겨 서버가 자동 종료한 집중의 <b>아직 안 보여 준</b> 결과 (GROMO-1998).
     * 보여 줄 것이 없으면 {@code {"data": null}} 이고 404 가 아니다 — {@code current} 와 같은 자리다.
     * 앱은 켤 때 이 값을 받아 결과창을 띄우고, 닫을 때 아래 {@code acknowledge} 를 부른다.
     */
    @GetMapping("/focus-sessions/pending-result")
    public FinishView pendingResult(HttpServletRequest request) {
        return focusSessions.pendingResult(sessions.requireSession(request), properties.deadline());
    }

    /**
     * 결과창을 보여 줬다고 표시한다 (GROMO-1998) — 이후로 {@code pending-result} 에 다시 오지 않는다.
     *
     * <p>본문도 {@code Idempotency-Key} 도 받지 않는다. Data 가 {@code acknowledged_at IS NULL} 조건부
     * UPDATE 로 최초 1회만 세팅하므로 재접속·동시 접속·재시도가 몇 번 오든 결과는 같다 — 멱등 키는
     * 「두 번 실행되면 안 되는」 명령의 장치이고 이건 그런 명령이 아니다(결과 확인 ack 의 선례:
     * {@code ChallengeResultAckController}).
     */
    @PostMapping("/focus-sessions/{sessionId}/acknowledge")
    public ResponseEntity<Void> acknowledge(@PathVariable String sessionId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        focusSessions.acknowledgeResult(claims, PublicIds.uuid(sessionId, "sessionId"), properties.deadline());
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/focus-sessions/{sessionId}/pause", consumes = "application/json")
    public StateView pause(@PathVariable String sessionId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return focusSessions.pause(claims, PublicIds.uuid(sessionId, "sessionId"), expectedVersion(body), key,
                properties.deadline());
    }

    @PostMapping(value = "/focus-sessions/{sessionId}/resume", consumes = "application/json")
    public StateView resume(@PathVariable String sessionId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return focusSessions.resume(claims, PublicIds.uuid(sessionId, "sessionId"), expectedVersion(body), key,
                properties.deadline());
    }

    @PostMapping(value = "/focus-sessions/{sessionId}/finish", consumes = "application/json")
    public FinishView finish(@PathVariable String sessionId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return focusSessions.finish(claims, PublicIds.uuid(sessionId, "sessionId"), expectedVersion(body), key,
                properties.deadline());
    }

    /**
     * {@code date}·{@code timezone} 의 <b>값</b> 판정은 Data 가 한다 — KST 규약을 두 곳에서 해석하지 않는다.
     * 여기서 보는 것은 값이 아니라 <b>개수</b>다({@link #single}).
     */
    @GetMapping("/me/focus-summary")
    public SummaryView summary(HttpServletRequest request) {
        return focusSessions.summary(sessions.requireSession(request), single(request, "date"),
                single(request, "timezone"), properties.deadline());
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
}

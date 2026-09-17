package com.oneorthree.phone.internal;

import com.oneorthree.phone.focus.dto.session.CurrentFocusSessionResponse;
import com.oneorthree.phone.focus.dto.session.FocusFinishView;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusSummaryView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 집중 세션 수명주기 6종의 <b>내부 표면</b> (GROMO-1764). 공개 경로가 아니다 — nginx 가 무접두
 * {@code /focus-sessions}·{@code /me} 를 Business 로 보내므로(위성 include 의 라우팅 정규식) data-api 가
 * 그 경로를 매핑해도 요청이 닿지 않는다. 공개 표면은 Business 의 {@code FocusSessionController} 이고
 * 여기는 그 위임만 받는다({@code InternalHostTransferController} 와 같은 결).
 *
 * <p>경로 규칙은 bff-screens 구현 문서 §1(B26)의 「사용자 축 공개 경로는
 * {@code /internal/users/{userId}/…}」다 — {@code InternalAuthFilter} 가 그 접두어를 읽어 경로의 userId 와
 * {@code X-User-Id} 헤더의 일치를 강제하기 때문이다. 그래서 여기서는 {@code @LoginUser} 를 쓰지 않고
 * 경로 변수로 주체를 받는다(앱 JWT 는 이 축에 오지 않는다).
 *
 * <p>응답은 {@code {"data": …}} 로 감싸지 않는다. 그 봉투는 Business 의 {@code ApiResponseAdvice} 몫이고
 * 내부 표면은 알맹이만 돌려준다. 계약 정본은
 * {@code docs/prd/fishcat/focus-rest-session/low-level-design.md} §2 이다.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalFocusSessionController {

    private final FocusSessionLifecycleService focusSessionLifecycleService;

    @PostMapping("/focus-sessions")
    @ResponseStatus(HttpStatus.CREATED)
    public FocusSessionView start(@PathVariable UUID userId,
                                  @RequestBody FocusSessionStartCommandRequest body,
                                  @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return focusSessionLifecycleService.start(userId, body, idempotencyKey);
    }

    @GetMapping("/focus-sessions/current")
    public CurrentFocusSessionResponse current(@PathVariable UUID userId) {
        return new CurrentFocusSessionResponse(focusSessionLifecycleService.current(userId));
    }

    @PostMapping("/focus-sessions/{sessionId}/pause")
    public FocusSessionView pause(@PathVariable UUID userId,
                                  @PathVariable UUID sessionId,
                                  @RequestBody FocusVersionedCommandRequest body,
                                  @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return focusSessionLifecycleService.pause(userId, sessionId, body, idempotencyKey);
    }

    @PostMapping("/focus-sessions/{sessionId}/resume")
    public FocusSessionView resume(@PathVariable UUID userId,
                                   @PathVariable UUID sessionId,
                                   @RequestBody FocusVersionedCommandRequest body,
                                   @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return focusSessionLifecycleService.resume(userId, sessionId, body, idempotencyKey);
    }

    @PostMapping("/focus-sessions/{sessionId}/finish")
    public FocusFinishView finish(@PathVariable UUID userId,
                                  @PathVariable UUID sessionId,
                                  @RequestBody FocusVersionedCommandRequest body,
                                  @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return focusSessionLifecycleService.finish(userId, sessionId, body, idempotencyKey);
    }

    @GetMapping("/focus-summary")
    public FocusSummaryView summary(@PathVariable UUID userId,
                                    @RequestParam(required = false) String date,
                                    @RequestParam(required = false) String timezone) {
        return focusSessionLifecycleService.summary(userId, date, timezone);
    }
}

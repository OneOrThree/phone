package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.ChallengeResultAckRequest;
import com.oneorthree.business.api.dto.ChallengeResultClaimRequest;
import com.oneorthree.business.api.dto.ChallengeResultClaimResponse;
import com.oneorthree.business.auth.LoginUser;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.usecase.RequestIdempotencyKeys;
import com.oneorthree.business.usecase.ResultAckUseCase;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 결과 모달의 <b>표시 선점(claim) · 확인 표시(ack)</b> — 기존 URI 를 그대로 쓴다.
 *
 * <ul>
 *   <li>{@code POST /api/v1/me/challenge-results/{sessionId}/claim} → 200 {@code {claimToken}}.
 *       바디는 <b>선택</b>이다(없으면 최초 획득, 토큰을 실으면 재검증 + 리스 연장)</li>
 *   <li>{@code POST /api/v1/me/challenge-results/{sessionId}/ack} → 200 본문 없음</li>
 * </ul>
 *
 * <p>{@code /me/challenge-results} <b>조회</b>는 이 서비스로 오지 않는다 — 위성을 조합할 필요가 없는
 * 순수 Data 읽기라 1661 의 전체 전환 때 함께 옮긴다. 최소 Business 의 범위를 여기서 넓히지 않는다.
 *
 * <p>선점 응답은 공개 {@code claimToken}만 반환한다. 내부 응답에 필드가 추가돼도 자동으로
 * 외부에 노출되지 않으며, 토큰 검증과 비멱등 명령의 재시도 금지는 유스케이스가 유지한다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ChallengeResultAckController {

    private final ResultAckUseCase resultAckUseCase;

    @PostMapping("/me/challenge-results/{sessionId}/claim")
    public ResponseEntity<ChallengeResultClaimResponse> claimDisplay(
            @PathVariable UUID sessionId,
            @RequestBody(required = false) ChallengeResultClaimRequest body,
            @LoginUser UUID userId) {

        UUID currentToken = body == null ? null : body.claimToken();
        return ResponseEntity.ok(
                resultAckUseCase.claimDisplay(userId, sessionId, currentToken, Deadline.unbounded()));
    }

    @PostMapping("/me/challenge-results/{sessionId}/ack")
    public ResponseEntity<Void> acknowledge(
            @PathVariable UUID sessionId,
            @RequestBody ChallengeResultAckRequest body,
            @LoginUser UUID userId,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        resultAckUseCase.acknowledge(userId, sessionId, body.claimToken(),
                RequestIdempotencyKeys.from(idempotencyKey), Deadline.unbounded());
        return ResponseEntity.ok().build();
    }
}

package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.ChallengeResultAckRequest;
import com.oneorthree.business.api.dto.ChallengeResultClaimRequest;
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
 * <p>선점 응답을 {@code Object} 로 그대로 통과시키는 이유: 기존 응답은 {@code {claimToken}} 한 필드지만
 * 상류가 필드를 늘릴 수 있고(additive 가 계약이다), Business 가 모양을 알고 있으면 그 변경마다 여기도
 * 배포해야 한다 — 제공자 선배포·소비자 후배포(㉹)를 지키려면 모르는 필드를 통과시키는 쪽이 맞다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ChallengeResultAckController {

    private final ResultAckUseCase resultAckUseCase;

    @PostMapping("/me/challenge-results/{sessionId}/claim")
    public ResponseEntity<Object> claimDisplay(
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

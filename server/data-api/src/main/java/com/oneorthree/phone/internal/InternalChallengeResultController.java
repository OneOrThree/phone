package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.dto.ChallengeResultClaimRequest;
import com.oneorthree.phone.group.dto.ChallengeResultClaimResponse;
import com.oneorthree.phone.group.service.ChallengeResultAckService;
import lombok.RequiredArgsConstructor;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;
import java.time.Instant;

/**
 * 결과 표시 선점·확인의 내부 표면 (A22 ⓓ).
 *
 * <h2>기존 앱 계약을 그대로 옮긴다</h2>
 * 서비스는 {@code /api/v1/me/challenge-results/{sessionId}/…} 가 쓰는 것과 <b>같은 것</b>이다.
 * 실패 코드도 기존 {@code GroupErrorCode} 이름 그대로 나간다({@code RESULT_CLAIM_HELD} ·
 * {@code RESULT_ALREADY_ACKED} · {@code RESULT_CLAIM_STALE} · {@code RESULT_NOT_SETTLED}) —
 * 앱이 그 문자열로 분기하므로 상수 이름이 곧 계약이다.
 *
 * <h2>이 트랜잭션에서 알림 DB 를 건드리지 않는다</h2>
 * §3 의 「Data → 알림 쓰기 금지」다. 억제는 알림 서버의 {@code prepare}/{@code commit} 이 담당하고,
 * 여기는 2단계의 <b>가운데</b>일 뿐이다.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalChallengeResultController {

    private final ChallengeResultAckService challengeResultAckService;

    /**
     * 결과 표시 선점 — 바디에 토큰이 있으면 「재검증 + 리스 연장」이다.
     *
     * <p>⚠️ 재시도 대상이 아니다. 조건부 원자 UPDATE 라 두 번째 시도가 남의 리스를 가져올 수 있고,
     * 실패 응답 자체가 계약이다.
     *
     * @param userId    요청자
     * @param sessionId 결과를 띄울 회차
     * @param body      {@code null} 이거나 {@code claimToken} 이 없으면 최초 획득
     * @return {@code {claimToken}}
     */
    @PostMapping("/challenge-results/{sessionId}/claim")
    public ResponseEntity<ChallengeResultClaimResponse> claimDisplay(
            @PathVariable UUID userId,
            @PathVariable UUID sessionId,
            @RequestBody(required = false) ChallengeResultClaimRequest body) {

        UUID currentToken = body == null ? null : body.claimToken();
        return ResponseEntity.ok(challengeResultAckService.claimDisplay(userId, sessionId, currentToken));
    }

    /**
     * 결과 확인 표시 — 2단계의 가운데다.
     *
     * <p>⚠️ 재시도 대상이 아니다. {@code acknowledged_at IS NULL} 조건부 UPDATE 라 두 번째 시도는
     * 0행이 되고, 그 0행을 실패로 읽으면 이미 성공한 ack 가 실패로 보고된다.
     *
     * @param userId    요청자
     * @param sessionId 회차
     * @param body      선점 때 받은 토큰
     */
    @PostMapping("/challenge-results/{sessionId}/ack")
    public ResponseEntity<Void> acknowledge(
            @PathVariable UUID userId,
            @PathVariable UUID sessionId,
            @Valid @RequestBody InternalResultAckRequest body) {

        challengeResultAckService.acknowledgeBefore(userId, sessionId, body.claimToken(), body.ackDeadlineAt());
        return ResponseEntity.ok().build();
    }

    /** Noti prepare가 저장한 기한을 그대로 전달한다. 앱의 기존 ACK 요청과는 별도 계약이다. */
    public record InternalResultAckRequest(UUID claimToken, @NotNull Instant ackDeadlineAt) { }

    // ⚠️ 정본 ack «조회»({@code GET /internal/users/{id}/result-ack}) 는 여기 없다.
    //    호출자가 Business 가 아니라 알림 서버이고, 알림 쪽 내부 표면은 별도 작업자가 소유한다.
    //    읽기 자체는 {@code ChallengeResultAckService.readAckState(userId, sessionId)} 가 제공하므로
    //    그 서비스를 그대로 쓰면 된다 — 같은 조회를 두 컨트롤러가 각자 만들면 「행이 없을 때」의
    //    처리(미확인으로 접는다)가 두 곳에서 갈린다.
}

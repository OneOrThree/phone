package com.oneorthree.phone.group;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.dto.ChallengeResultAckRequest;
import com.oneorthree.phone.group.dto.ChallengeResultClaimRequest;
import com.oneorthree.phone.group.dto.ChallengeResultClaimResponse;
import com.oneorthree.phone.group.service.ChallengeResultAckService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 결과 모달의 <b>표시 선점(claim) · 확인 표시(ack)</b> 쓰기 축 (GROMO-1577 · policy N58·B17).
 * 목록 조회({@code GET /me/challenge-results})는 조회 축인 {@link GroupBetQueryController} 가 계속
 * 소유하고, 여기는 같은 자원의 <b>상태 전이</b>만 맡는다 — 조회 축은 "돈이 움직이지 않는 순수 읽기"라는
 * 규율로 서 있고(그 서비스는 {@code readOnly = true}), 경쟁을 판정하는 조건부 원자 UPDATE 를 그
 * 안에 섞으면 어느 경로에 잠금 규율이 있는지 흐려진다.
 *
 * <p>앱의 순서는 <b>slot 확보 → 선점 → 활성 claim 재검증 → 노출 → ack</b> 다(IA §4.3 · 계약 D8).
 * 재검증은 별도 엔드포인트가 아니라 <b>{@code claim} 에 토큰을 실어 보내는 것</b>이고, 그 한 번의
 * 쓰기가 검증과 리스 연장을 함께 한다. ack 를 노출 앞에 두면 렌더가 중단됐을 때 어느 기기에서도
 * 그 결과를 못 본다.
 *
 * <p>Swagger 애노테이션은 {@link ChallengeResultAckControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ChallengeResultAckController implements ChallengeResultAckControllerDocs {

    private final ChallengeResultAckService challengeResultAckService;

    @Override
    @PostMapping("/me/challenge-results/{sessionId}/claim")
    public ResponseEntity<ChallengeResultClaimResponse> claimDisplay(
            @PathVariable UUID sessionId,
            @RequestBody(required = false) ChallengeResultClaimRequest body,
            @LoginUser UUID userId
    ) {
        UUID currentToken = body == null ? null : body.claimToken();
        return ResponseEntity.ok(
                challengeResultAckService.claimDisplay(userId, sessionId, currentToken));
    }

    @Override
    @PostMapping("/me/challenge-results/{sessionId}/ack")
    public ResponseEntity<Void> acknowledge(
            @PathVariable UUID sessionId,
            @RequestBody ChallengeResultAckRequest body,
            @LoginUser UUID userId
    ) {
        challengeResultAckService.acknowledge(userId, sessionId, body.claimToken());
        return ResponseEntity.ok().build();
    }
}

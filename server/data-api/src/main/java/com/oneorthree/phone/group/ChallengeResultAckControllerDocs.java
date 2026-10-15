package com.oneorthree.phone.group;

import com.oneorthree.phone.group.dto.ChallengeResultAckRequest;
import com.oneorthree.phone.group.dto.ChallengeResultClaimRequest;
import com.oneorthree.phone.group.dto.ChallengeResultClaimResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code ChallengeResultAckController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "Challenge Result Ack", description = "챌린지 결과 모달 1회 노출 가드 (GROMO-1577)"
        + " — 표시 선점(lease)과 확인 표시(ack). 가드의 정본이 앱 로컬 마커에서 서버로 옮겨졌다(N58):"
        + " 로컬 단독 가드는 기기 교체·재설치에서 최근 30일 결과가 통째로 재생된다")
public interface ChallengeResultAckControllerDocs {

    /**
     * @param sessionId 결과를 띄울 회차 — 아직 정산 전이거나 이미 확인 처리됐으면 409 다
     * @param body 선택 — claimToken 을 실으면 최초 획득이 아니라 재검증 + 리스 연장이다
     * @param userId 요청자 — 그 회차에 내 참가 행이 없으면 404
     * @return 이 기기가 결과를 띄워도 된다는 증표(claimToken)와 리스 만료 힌트
     */
    @Operation(summary = "결과 표시 선점 (claim) · 렌더 직전 재검증",
            description = "그 회차 결과를 이 기기가 표시하겠다고 선점한다. 만료가 있는 점유라 선점한"
                    + " 기기가 렌더 전에 죽어도 리스가 끝나면 다른 기기가 회수한다. 성공 응답의"
                    + " claimToken 은 ack 에 그대로 실어 보낸다. 실패(409 RESULT_CLAIM_HELD)는 영구"
                    + " 거절이 아니라 '이번엔 건너뛴다'이며, 응답 바디의 retryAfterMs(밀리초, 상대"
                    + " 지연)만큼 뒤에 1회만 다시 시도하면 된다 — ⚠️ 절대 만료 시각은 주지 않는다."
                    + " 기기 시계가 서버와 어긋나면 살아 있는 선점을 즉시 다시 요청해 기회를 태우거나"
                    + " 만료 뒤에도 한참 결과를 안 띄우기 때문이다. 이미 확인 처리된 회차는 선점 자체가"
                    + " 성립하지 않는다(RESULT_ALREADY_ACKED) — 이 조건이 없으면 두 기기가 함께"
                    + " 미확인을 조회한 뒤 한쪽이 ack 를 끝내도 다른 쪽이 같은 결과를 다시 렌더한다."
                    + " 바디에 claimToken 을 실으면 최초 획득이 아니라 '렌더 직전 재검증 + 리스 연장'"
                    + " 이다(검증과 연장이 한 번의 쓰기 — 따로 두면 그 사이에 만료되는 TOCTOU 가"
                    + " 남는다). 내 선점이 아직 내 것이면 같은 토큰을 그대로 돌려주고(토큰은 회전하지"
                    + " 않는다 — 갱신 응답이 유실되면 ack 까지 막히기 때문), 그 사이 리스가 만료돼 다른"
                    + " 기기가 재선점했으면 409 RESULT_CLAIM_HELD 로 막는다. 이 재검증이 없으면 정지됐다"
                    + " 깨어난 기기가 낡은 성공 응답만 믿고 띄워 두 기기가 모두 모달을 본다."
                    + " 바디는 선택이며, 바디 없는 호출은 지금처럼 최초 획득이다(additive).")
    @ApiResponses({
        @ApiResponse(responseCode = "200",
                description = "선점 성공(최초 획득 시 신규 claimToken / 재검증 시 같은 토큰 + 리스 연장)"),
        @ApiResponse(responseCode = "409",
                description = "RESULT_CLAIM_HELD(다른 기기가 표시 중이거나 내 선점이 남에게 넘어감"
                        + " — 바디에 retryAfterMs) / RESULT_ALREADY_ACKED(이미 확인된 결과)"
                        + " / RESULT_NOT_SETTLED(아직 정산 전인 OPEN 회차 — 여기서 확인 표시가 찍히면"
                        + " 나중에 정산된 그 결과를 어느 기기에서도 못 본다)"),
        @ApiResponse(responseCode = "404",
                description = "BET_NOT_FOUND(그 회차의 내 참가 행 없음)"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
    ResponseEntity<ChallengeResultClaimResponse> claimDisplay(UUID sessionId, ChallengeResultClaimRequest body,
            UUID userId);

    /**
     * @param sessionId 확인 처리할 회차 — 아직 정산 전이면 409 다
     * @param body 선점 때 받은 claimToken — 현재 선점과 다르면 409(내 리스가 남에게 넘어갔다)
     * @param userId 요청자 — 확인 표시는 유저별이라 다른 멤버의 모달에는 영향이 없다
     * @return 본문 없는 200. 대상 행 없음·중복 호출도 no-op 성공이다(멱등)
     */
    @Operation(summary = "결과 확인 표시 (ack)",
            description = "모달이 실제로 노출된 뒤에 호출한다. 선점 때 받은 claimToken 을 실어 보내면"
                    + " 그 회차를 확인 처리해 다시 노출되지 않게 한다 — acknowledged_at IS NULL 조건부"
                    + " 원자 UPDATE 라 중복·동시 호출에도 최초 1회만 세팅된다. 대상 행 없음·이미"
                    + " 확인됨·중복 호출은 전부 no-op 이며 200 이다(멱등). 토큰이 현재 선점과 다르면"
                    + " 409 RESULT_CLAIM_STALE — 내 선점이 만료돼 다른 기기가 재선점한 경우라, 여기서"
                    + " 확인 처리하면 그 기기가 띄우려던 결과를 삼킨다. 확인이 성사되면 그 회차의 아직"
                    + " 안 나간 BET_RESULT 푸시 클레임도 함께 닫는다 — 안 닫으면 이미 본 결과의 푸시가"
                    + " 묶음 슬롯이 닫힌 뒤나 조용한 시간 이월 뒤에 도착한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "확인 처리 성공(멱등)"),
        @ApiResponse(responseCode = "409",
                description = "RESULT_CLAIM_STALE(토큰이 현재 선점과 다름)"
                        + " / RESULT_NOT_SETTLED(아직 정산 전인 OPEN 회차)")
    })
    ResponseEntity<Void> acknowledge(UUID sessionId, ChallengeResultAckRequest body, UUID userId);
}

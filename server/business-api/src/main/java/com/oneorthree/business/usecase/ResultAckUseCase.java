package com.oneorthree.business.usecase;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.notification.dto.ResultAckPrepareResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.UUID;
import java.util.Map;

/**
 * 결과 확인(ack) ↔ 대기 중 푸시 직렬화 (A22 ⓓ · ㊅). 기존 앱 계약
 * {@code POST /api/v1/me/challenge-results/{sessionId}/claim} · {@code .../ack} 를 보존한다.
 *
 * <h2>왜 2단계인가</h2>
 * 현행 {@code ChallengeResultAckService.acknowledge} 는 <b>확인 트랜잭션 안에서</b>
 * {@code BetResultAckSuppressionListener} 가 대기 중인 알림 클레임·tombstone 을 함께 갱신해, 5분 flush
 * 가 이미 본 결과를 뒤늦게 보내지 못하게 막는다. 알림 DB 를 분리하면 그 갱신 대상이
 * {@code gromo_notification} 으로 넘어가 <b>같은 트랜잭션에 담을 수 없고</b>, ack 를 이벤트로만 보내면
 * Data 커밋과 알림 소비 사이에 flush 가 끼어들어 사용자가 이미 확인한 결과 푸시를 다시 받는다.
 *
 * <h2>순서</h2>
 * ① 알림 {@code prepare}(HELD 잠금 — <b>행이 없어도 tombstone 을 만든다</b>, ㊅) → ② Data ack 커밋 →
 * ③ 알림 {@code commit}. ②가 실패하면 ③ 대신 {@code abort} 를 보내고 ②의 실패를 그대로 올린다.
 *
 * <h2>수렴 계약 — 성공한 척하지 않는다</h2>
 * <ul>
 *   <li>①이 실패하면 ②를 하지 않는다. 억제 없이 ack 를 커밋하면 그 세션의 대기 푸시가 그대로 나간다.</li>
 *   <li>③이 실패해도 사용자 요청은 <b>성공</b>이다 — Data 의 {@code acknowledged_at} 은 이미 박혔다.
 *       남은 {@code HELD} 는 <b>리스 만료 시 {@code NEEDS_CONFIRM}</b> 으로 넘어가 flush 가 계속
 *       건너뛰고, 해제는 알림 서버의 <b>Data 정본 ack 조회</b>로 자기 수렴한다(조회 3종의 두 번째).
 *       그 조회 경로가 없으면 「롤백 직후 프로세스가 죽는 구간」에서 abort 행이 안 생겨 영구 억제가
 *       실재한다.</li>
 *   <li>{@code abort} 가 실패해도 덮지 않는다 — 같은 {@code NEEDS_CONFIRM} 수렴에 맡기고, 사용자에게는
 *       ②의 실패를 올린다. 「단순 전달」만 하고 성공을 꾸며내지 않는다.</li>
 * </ul>
 *
 * <p><b>리스 만료는 fail-closed 다</b> — 자동 발송 재개가 아니다. 그 판정은 알림 서버가 갖고,
 * Business 는 여기서 어떤 우회도 만들지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ResultAckUseCase {

    private final DataApiClient dataApiClient;
    private final NotificationApiClient notificationApiClient;

    /**
     * 결과 표시 선점 — <b>알림 서버가 끼지 않는다</b>. 순수 Data 쓰기이고, 실패 응답
     * ({@code RESULT_CLAIM_HELD} + {@code retryAfterMs} · {@code RESULT_ALREADY_ACKED} ·
     * {@code RESULT_NOT_SETTLED})이 그대로 앱에 중계된다.
     *
     * <p>활성 검사를 걸지 않는 이유: 위성 쓰기가 아니고, Data 가 {@code /internal/*} 호출마다
     * {@code X-User-Id} 활성 검사를 한다(§5).
     */
    public Object claimDisplay(UUID userId, UUID sessionId, UUID currentToken, Deadline deadline) {
        Object response = dataApiClient.claimResultDisplay(userId, sessionId, currentToken, deadline);
        if (!(response instanceof Map<?, ?> body) || !(body.get("claimToken") instanceof String token)
                || !validClaimToken(token)) {
            throw new UpstreamContractMismatchException("결과 표시 선점 응답에 유효한 claimToken이 없습니다");
        }
        // Data의 추가 필드는 그대로 보존한다. 비멱등 선점을 여기서 재시도하지 않는다.
        return response;
    }

    private static boolean validClaimToken(String token) {
        try {
            return UUID.fromString(token).toString().equalsIgnoreCase(token);
        } catch (IllegalArgumentException malformed) {
            return false;
        }
    }

    /** 확인 표시 — prepare → Data commit → noti commit. */
    public void acknowledge(UUID userId, UUID sessionId, UUID claimToken, RequestIdempotencyKeys keys,
            Deadline deadline) {

        ResultAckPrepareResult prepared = notificationApiClient.prepareResultAck(
                userId, sessionId, keys.forStep("ack-prepare"), deadline);
        if (prepared == null) {
            throw new UpstreamContractMismatchException("알림 prepare 응답 본문이 없습니다");
        }
        if (!"CONFIRMED".equals(prepared.state())
                && !("HELD".equals(prepared.state()) && prepared.held())) {
            throw new UpstreamContractMismatchException("알림 prepare 응답이 결과 푸시 보류를 보장하지 않습니다");
        }
        // CONFIRMED는 Data 성공 뒤에만 도달하는 종결 상태다. 새 쓰기나 실행 기한이 필요 없다.
        if ("CONFIRMED".equals(prepared.state())) {
            return;
        }
        Instant ackDeadlineAt;
        try {
            if (prepared.ackDeadlineAt() == null) {
                throw new UpstreamContractMismatchException("알림 prepare 응답에 ackDeadlineAt이 없습니다");
            }
            ackDeadlineAt = Instant.parse(prepared.ackDeadlineAt());
        } catch (DateTimeParseException malformed) {
            throw new UpstreamContractMismatchException("알림 prepare 응답의 ackDeadlineAt이 시각이 아닙니다");
        }
        // 기한을 이 서버 시계로 갱신·판정하지 않는다. Data 쓰기와 정본 조회가 같은 DB 시계로 판정한다.
        log.debug("ack prepare 완료 — sessionId={} held={} state={}",
                sessionId, prepared.held(), prepared.state());

        try {
            dataApiClient.acknowledgeResult(userId, sessionId, claimToken, ackDeadlineAt, deadline);
        } catch (RuntimeException e) {
            abortQuietly(userId, sessionId, keys, deadline);
            throw e;
        }

        try {
            notificationApiClient.commitResultAck(userId, sessionId, keys.forStep("ack-commit"), deadline);
        } catch (RuntimeException e) {
            // Data ack 는 이미 커밋됐다. HELD 는 NEEDS_CONFIRM 으로 넘어가 flush 가 건너뛰고,
            // 알림 서버가 Data 정본 ack 조회로 스스로 수렴한다 — 사용자 요청을 실패시키지 않는다.
            log.warn("ack commit 실패 — NEEDS_CONFIRM 수렴에 맡긴다. sessionId={}", sessionId, e);
        }
    }

    /**
     * 롤백. <b>실패를 덮지 않는다</b> — abort 행이 안 생기는 구간은 알림 서버의 정본 ack 조회로
     * 수렴하는 것이 계약이다. 여기서 성공한 척하면 그 수렴이 필요하다는 사실 자체가 가려진다.
     */
    private void abortQuietly(UUID userId, UUID sessionId, RequestIdempotencyKeys keys, Deadline deadline) {
        try {
            notificationApiClient.abortResultAck(userId, sessionId, keys.forStep("ack-abort"), deadline);
        } catch (RuntimeException e) {
            log.error("ack abort 실패 — HELD 가 남는다. 해제는 NEEDS_CONFIRM + Data 정본 ack 조회로 수렴한다."
                    + " sessionId={}", sessionId, e);
        }
    }
}

package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.ClaimConfirmationRequest;
import com.oneorthree.phone.internal.dto.ClaimIntentAckResponse;
import com.oneorthree.phone.internal.dto.ClaimIntentCompletionRequest;
import com.oneorthree.phone.internal.dto.ClaimIntentLeaseRequest;
import com.oneorthree.phone.internal.dto.ClaimIntentLeaseResponse;
import com.oneorthree.phone.internal.dto.ClaimIntentPageResponse;
import com.oneorthree.phone.internal.dto.ClaimIntentRequest;
import com.oneorthree.phone.internal.dto.DurableCommandAckResponse;
import com.oneorthree.phone.internal.dto.InviteIssueContextResponse;
import com.oneorthree.phone.internal.service.InternalInviteLinkService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 초대 링크 관련 내부 표면 — 발급 컨텍스트 · claim 의도 큐 · claim 확정 (A22 ㊫ · ㊄ · ㋟).
 *
 * <h2>두 종류의 호출자가 섞여 있다</h2>
 * 발급 컨텍스트·의도 적재·확정은 <b>사용자 위임</b>({@code X-User-Id})이고, 의도 목록·선점·완료는
 * <b>서비스 전용</b>이다(운영자가 도는 재개 실행자). 둘을 가르는 것은 이 클래스가 아니라
 * caller 별 허용목록이다(㉱) — 이름만 나누면 최소 권한이 서지 않는다.
 *
 * <h2>Data 는 이 큐를 스스로 밟지 않는다</h2>
 * 링크 조회·claim 실행은 단방향 규칙(§3)과 ㋟ 를 동시에 어긴다. 여기서 제공하는 것은 <b>상태</b>뿐이고,
 * 재개는 Business 쪽 실행자가 같은 조합(링크 잠정 → Data 확정)을 다시 밟는다.
 */
@RestController
@RequestMapping("/internal")
@RequiredArgsConstructor
public class InternalInviteLinkController {

    /** 선점 기본 기간 — 요청이 값을 주지 않았을 때. */
    private static final int DEFAULT_LEASE_SECONDS = 120;

    private final InternalInviteLinkService internalInviteLinkService;

    /**
     * 링크 발급에 실을 코어의 사실.
     *
     * <p><b>{@code inviterId} 를 쿼리로 받지 않는다</b> — 받으면 남을 발급자로 지정하는 표면이 생긴다.
     * 발급자는 {@code X-User-Id} 다.
     *
     * @param groupId   초대 대상 그룹
     * @param inviterId {@code X-User-Id}
     * @return 발급 컨텍스트
     */
    @GetMapping("/groups/{groupId}/invite-issue-context")
    public ResponseEntity<InviteIssueContextResponse> issueContext(
            @PathVariable UUID groupId, @RequestHeader("X-User-Id") UUID inviterId) {
        return ResponseEntity.ok(internalInviteLinkService.issueContext(groupId, inviterId));
    }

    /**
     * claim 의도 내구 적재 — {@code 202} 를 줄 수 있는 유일한 근거 (㊄ · ㊺).
     *
     * <p><b>이 표면만 {@link ClaimIntentAckResponse} 를 쓴다</b> — 공용 ack 에 {@code completed} 를
     * 더한 것이다. 같은 요청 키로 다시 온 «이미 종결된» 의도는 {@code completed=true} 로 돌아오고,
     * Business 는 그걸 202 로 접지 않는다(재개 sweep 은 {@code PENDING} 만 보므로 그 202 는 아무도
     * 이어받지 않는다). 다른 키는 같은 slug 라도 새 {@code PENDING} 의도를 받아 {@code false} 다.
     *
     * <p>같은 키로 <b>다른 slug</b> 가 오면 재시도가 아니라 키를 재사용한 별개 명령이다 —
     * {@code IDEMPOTENCY_KEY_CONFLICT}(409) 로 거절된다.
     *
     * @param userId         {@code X-User-Id}
     * @param request        초대 slug
     * @param idempotencyKey {@code Idempotency-Key}
     * @return 의도 식별자 · 순서 version · 이미 종결됐는가
     */
    @PostMapping("/invite-links/claim-intents")
    public ResponseEntity<ClaimIntentAckResponse> enqueueClaimIntent(
            @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody ClaimIntentRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {

        InternalInviteLinkService.ClaimIntentAck ack =
                internalInviteLinkService.enqueueClaimIntent(userId, request.slug(), idempotencyKey);
        return ResponseEntity.ok(new ClaimIntentAckResponse(
                ack.commandId(), ack.eventId(), ack.version(), ack.completed()));
    }

    /**
     * 잠정 claim 을 멤버십 락 아래 확정한다 (㋟ · ⓚ).
     *
     * @param userId         {@code X-User-Id}
     * @param request        잠정 claim id · slug · 링크가 서명한 자격
     * @param idempotencyKey {@code Idempotency-Key}
     * @return 완성된 봉투
     */
    @PostMapping("/invite-links/claim-confirmations")
    public ResponseEntity<DurableCommandAckResponse> confirmClaim(
            @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody ClaimConfirmationRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {

        InternalInviteLinkService.ClaimIntentAck ack = internalInviteLinkService.confirmClaim(
                userId, request.claimId(), request.slug(), request.capability(), idempotencyKey);
        return ResponseEntity.ok(
                new DurableCommandAckResponse(ack.commandId(), ack.eventId(), ack.version()));
    }

    /**
     * 확정할 것이 없던 의도를 <b>요청자 자신이</b> 종결한다 — <b>사용자 위임</b>({@code X-User-Id}) 경로다.
     *
     * <p>링크가 {@code claimId=null} 을 주는 경우(셀프 초대 · 붙일 클릭 없음)에는 확정이 없어
     * {@link #confirmClaim} 가 의도를 닫아 주지 못한다. 그 한 건이 {@code PENDING} 으로 남으면 「미완료 0」
     * gate 를 영구히 막는다. 아래 {@code /completed} 를 빌려 쓰지 않는 이유는 그것이 <b>서비스 전용
     * 재개 표면</b>이기 때문이다 — 요청 경로에 리스 선점·완료 권한을 주면 임의 의도를 닫을 수 있게 된다.
     *
     * @param commandId 의도 식별자
     * @param userId    {@code X-User-Id} — 의도의 주인이어야 한다
     */
    @PostMapping("/invite-links/claim-intents/{commandId}/abandoned")
    public ResponseEntity<Void> abandonClaimIntent(
            @PathVariable UUID commandId, @RequestHeader("X-User-Id") UUID userId) {
        internalInviteLinkService.abandonClaimIntent(userId, commandId);
        return ResponseEntity.ok().build();
    }

    /**
     * 재개 대상 목록 — <b>서비스 전용</b>이다.
     *
     * <p>{@code pendingCount} 가 0 이어야 「남은 것이 없다」다. 커서는 한 번의 훑기 안에서 페이지를
     * 잇는 용도일 뿐이고, 늦게 커밋된 행을 놓치지 않으려면 실행자가 <b>매번 처음부터</b> 다시 훑어야 한다.
     *
     * @param cursor 직전 페이지의 마지막 {@code commandId}
     * @param limit  최대 건수
     * @return 한 페이지와 미완료 전체 수
     */
    @GetMapping("/invite-links/claim-intents")
    public ResponseEntity<ClaimIntentPageResponse> listClaimIntents(
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(internalInviteLinkService.listClaimIntents(cursor, limit));
    }

    /**
     * 재개 대상 선점.
     *
     * @param commandId 의도 식별자
     * @param request   리스 기간. 없으면 기본값
     * @return 선점 결과 — {@code leased=false} 는 오류가 아니라 「남이 잡고 있다」다
     */
    @PostMapping("/invite-links/claim-intents/{commandId}/lease")
    public ResponseEntity<ClaimIntentLeaseResponse> leaseClaimIntent(
            @PathVariable UUID commandId,
            @Valid @RequestBody(required = false) ClaimIntentLeaseRequest request) {

        int leaseSeconds = request == null || request.leaseSeconds() == null
                ? DEFAULT_LEASE_SECONDS : request.leaseSeconds();
        return ResponseEntity.ok(internalInviteLinkService.leaseClaimIntent(commandId, leaseSeconds));
    }

    /**
     * 재개 완료 보고 — 같은 성공 토큰의 재시도는 200, 다른·낡은 토큰은 409 다.
     *
     * @param commandId 의도 식별자
     * @param request   선점 때 받은 펜싱 토큰
     */
    @PostMapping("/invite-links/claim-intents/{commandId}/completed")
    public ResponseEntity<Void> completeClaimIntent(
            @PathVariable UUID commandId, @Valid @RequestBody ClaimIntentCompletionRequest request) {
        internalInviteLinkService.completeClaimIntent(commandId, request.leaseToken());
        return ResponseEntity.ok().build();
    }
}

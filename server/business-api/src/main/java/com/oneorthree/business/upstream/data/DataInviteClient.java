package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.ClaimIntentAck;
import com.oneorthree.business.upstream.data.dto.ClaimIntentLease;
import com.oneorthree.business.upstream.data.dto.ClaimIntentPage;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.data.dto.FrozenClickCandidate;
import com.oneorthree.business.upstream.data.dto.InviteIssueContext;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 초대 링크 claim 파이프라인의 Data 호출 — 발급 컨텍스트, claim 의도 적재·확정·재개, 정지 후보 export. */
public class DataInviteClient {

    private static final String PATH_INVITE_ISSUE_CONTEXT = "/internal/groups/{groupId}/invite-issue-context";
    private static final String PATH_CLAIM_INTENTS = "/internal/invite-links/claim-intents";
    private static final String PATH_CLAIM_CONFIRMATIONS = "/internal/invite-links/claim-confirmations";
    private static final String PATH_CLAIM_INTENTS_PENDING = "/internal/invite-links/claim-intents";
    private static final String PATH_CLAIM_INTENT_LEASE =
            "/internal/invite-links/claim-intents/{commandId}/lease";
    private static final String PATH_CLAIM_INTENT_COMPLETED =
            "/internal/invite-links/claim-intents/{commandId}/completed";
    private static final String PATH_CLAIM_INTENT_ABANDONED =
            "/internal/invite-links/claim-intents/{commandId}/abandoned";
    private static final String PATH_FROZEN_CANDIDATES =
            "/internal/migrations/{migrationId}/invite-link-clicks/candidates";

    private final InternalHttpClient http;

    public DataInviteClient(InternalHttpClient http) {
        this.http = http;
    }

    /** 링크 발급에 실을 코어 사실을 받는다 — 그룹 활성·멤버십·스냅샷·epoch·linkVersion. */
    public InviteIssueContext fetchInviteIssueContext(UUID groupId, UUID inviterId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET,
                                PATH_INVITE_ISSUE_CONTEXT.replace("{groupId}", groupId.toString()))
                        .onBehalfOf(inviterId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<InviteIssueContext>() { });
    }

    /**
     * claim 의도를 Data 에 <b>내구 적재</b>한다 — {@code 202} 를 줄 수 있는 유일한 근거다.
     *
     * <p>정지 창의 claim 은 거절이 아니라 대기다(A22 ㊄: 앱은 다음 로그인까지 재시도하지 않는다).
     * 전역 15초를 넘길 위험이 있으면 {@code 202} 로 받되, <b>큐 커밋 전에는 202 를 응답하지 않는다</b>.
     */
    public ClaimIntentAck enqueueClaimIntent(UUID userId, String slug, String idempotencyKey,
            Deadline deadline) {
        ClaimIntentAck intent = http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_CLAIM_INTENTS)
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(Map.of("slug", slug))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ClaimIntentAck>() { });
        if (intent == null || intent.commandId() == null
                || intent.eventId() == null || intent.eventId().isBlank() || intent.version() <= 0) {
            throw new UpstreamContractMismatchException("초대 claim 의도 응답이 완전하지 않습니다");
        }
        return intent;
    }

    /**
     * 링크가 만든 <b>잠정(pending) claim</b> 을 Data 의 멤버십 락 아래에서 확정한다 (A22 ㋟).
     *
     * <p>확정 전달은 <b>Business 가 링크를 직접 호출하지 않는다</b> — Data 가 락 아래
     * {@code link.claimConfirmed} outbox 를 기록하고 relay 가 전달한다. 락을 잡은 채 외부 호출은 §3
     * 위반이고, 락이 풀린 뒤 Business 가내면 그 사이 revoke 가 끼어든다.
     *
     * @param capability 링크 서버가 서명한 자격(slug · groupId · inviterId · membershipEpoch · 만료).
     *                   Data 가 <b>커밋 안에서</b> 현재 그룹 상태·멤버십 epoch 와 대조한다(ⓚ)
     */
    public DurableCommandAck confirmClaim(UUID userId, UUID claimId, String slug, String capability,
            String idempotencyKey, Deadline deadline) {
        DurableCommandAck confirmed = http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_CLAIM_CONFIRMATIONS)
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(new ClaimConfirmationCommand(claimId, slug, capability))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
        if (confirmed == null || confirmed.commandId() == null
                || confirmed.eventId() == null || confirmed.eventId().isBlank() || confirmed.version() <= 0) {
            throw new UpstreamContractMismatchException("초대 claim 확정 응답이 완전하지 않습니다");
        }
        return confirmed;
    }

    /**
     * 구 {@code invite_link_clicks} 정지 스냅샷의 <b>read-only export</b> (§7.2 5단계).
     *
     * <p>Business 는 이 후보를 <b>소진하지 않는다</b> — 쓰기 원장은 Neon 하나다(A22 ㊥).
     * {@code migrationId} 로 제한된 이관 경로이고 일반 방문자 입력으로 받지 않는다.
     */
    public List<FrozenClickCandidate> exportFrozenCandidates(String migrationId, String ipHash, String os,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_FROZEN_CANDIDATES.replace("{migrationId}", migrationId))
                        .query("ipHash", ipHash)
                        .query("os", os)
                        .build(),
                deadline,
                new ParameterizedTypeReference<List<FrozenClickCandidate>>() { });
    }

    /**
     * 미완료 claim 의도 조회 — <b>서비스 전용</b>이라 {@code X-User-Id} 가 없다. 재개 CLI 만 쓴다.
     *
     * <p>이 경로가 없으면 큐에 적재된 의도를 비울 주체가 존재하지 않는다 — Business 에는 크론이 없고
     * (§6) Data 는 링크를 relay 허용목록 밖으로 부를 수 없다(§3).
     */
    public ClaimIntentPage fetchPendingClaimIntents(String cursor, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_CLAIM_INTENTS_PENDING)
                        .query("cursor", cursor)
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<ClaimIntentPage>() { });
    }

    /**
     * lease 획득. CLI 중복 실행·이전 실행의 잔여가 같은 의도를 동시에 재생하는 것을 막는다.
     *
     * <p>재시도한다: 같은 소유자가 같은 의도에 다시 요청하면 같은 답이 나와야 하고(멱등), 여기서
     * 실패를 올리면 그 의도만 영구히 건너뛴다.
     */
    public ClaimIntentLease leaseClaimIntent(UUID commandId, long leaseSeconds, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST,
                                PATH_CLAIM_INTENT_LEASE.replace("{commandId}", commandId.toString()))
                        .body(Map.of("leaseSeconds", leaseSeconds))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ClaimIntentLease>() { });
    }

    /**
     * 재개 완료 표시 — <b>{@code leaseToken} 으로 CAS</b> 한다.
     *
     * <p>토큰 없이 완료 표시하면 <b>임대가 만료된 뒤 깨어난 옛 작업자가 「새 임대 소유자의 작업」을
     * 완료로 빼 버린다</b>: A 의 lease 가 만료되고 B 가 새로 잡아 재생 중인데 느려진 A 가 완료를
     * 부르면, B 의 진행과 무관하게 큐에서 사라져 <b>확정되지 않은 claim 이 「완료」로 기록</b>된다.
     * 현재 임대의 토큰과 다르면 Data 가 거부해야 한다.
     *
     * <p>같은 토큰으로 다시 와도 200 이어야 한다(멱등) — 409 면 CLI 가 정상 중복을 오류로 센다.
     */
    public void completeClaimIntent(UUID commandId, UUID leaseToken, Deadline deadline) {
        completeClaimIntent(commandId, leaseToken, null, deadline);
    }

    /** 재개 중 확정된 거절 코드도 원래 요청의 재생을 위해 전달한다. */
    public void completeClaimIntent(UUID commandId, UUID leaseToken, String terminalCode, Deadline deadline) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("leaseToken", leaseToken.toString());
        if (terminalCode != null) {
            body.put("terminalCode", terminalCode);
        }
        http.execute(
                InternalCall.to(HttpMethod.POST,
                                PATH_CLAIM_INTENT_COMPLETED.replace("{commandId}", commandId.toString()))
                        .body(body)
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /**
     * 확정할 것이 없던 claim 의도를 <b>요청자 자신이</b> 종결한다 — 사용자 위임 경로다.
     *
     * <p>링크가 {@code claimId=null} 을 주면(셀프 초대 · 붙일 클릭 없음) 확정 호출이 없고, 확정이
     * 없으면 Data 의 확정 경로가 의도를 닫아 주지도 못한다 — 그 한 건이 {@code PENDING} 으로 남아
     * <b>정상 처리된 claim 이 「미완료 0」 gate 를 영구히 막는다</b>.
     *
     * <p><b>{@code markCommandDelivered} 로 닫을 수 없다.</b> 그쪽은 봉투의 {@code eventId} 로
     * 「알림 대상 전달」을 닫는 경로이고 claim 의도는 outbox 행이 아니다 — 의도 id 를 그 경로에내면
     * <b>항상 404</b> 다. 반대로 {@code …/completed} 는 lease 를 쥔 <b>서비스 전용</b> 재개 표면이라
     * 요청 경로가 빌려 쓰면 임의 의도를 선점·완료할 권한이 생긴다.
     *
     * <p>이미 종결된 의도에 다시 와도 200 이다(멱등). 이 호출의 실패는 사용자 요청을 실패시키지
     * 않는다 — 남은 의도는 재개 CLI 가 한 번 더 밟고, 그쪽도 같은 「붙일 대상 없음」으로 종결한다.
     */
    public void abandonClaimIntent(UUID userId, UUID commandId, String terminalCode, Deadline deadline) {
        // 종결 코드를 함께 남긴다. 원장이 그 코드를 갖고 있어야 같은 요청 키의 재시도가 「첫 요청이
        // 받은 그 판정」을 그대로 재생할 수 있다 — 없으면 첫 요청은 4xx, 재시도는 200 이 된다.
        //
        // 코드는 «본문»으로 보낸다. 경로에 실으면 같은 종결이 코드마다 다른 URL 이 되어, 경로로
        // 계약을 고정한 검사들이 값에 따라 갈린다 — 경로는 「무엇을 하는가」지 「왜 하는가」가 아니다.
        InternalCall.Builder call = InternalCall.to(HttpMethod.POST,
                        PATH_CLAIM_INTENT_ABANDONED.replace("{commandId}", commandId.toString()))
                .onBehalfOf(userId)
                .idempotentCommand();
        if (terminalCode != null) {
            call.body(Map.of("terminalCode", terminalCode));
        }
        http.execute(call.build(), deadline);
    }

    /** claim 확정 요청 본문. */
    record ClaimConfirmationCommand(UUID claimId, String slug, String capability) {
    }
}

package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.ClaimIntentLease;
import com.oneorthree.business.upstream.data.dto.ClaimIntentPage;
import com.oneorthree.business.upstream.data.dto.DeviceSessionCheck;
import com.oneorthree.business.upstream.data.dto.ClaimIntentAck;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.data.dto.FrozenClickCandidate;
import com.oneorthree.business.upstream.data.dto.InviteIssueContext;
import com.oneorthree.business.upstream.data.dto.UserActivation;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Data API 로 나가는 유일한 창구. 경로가 <b>여기 상수로만</b> 존재하므로 임의 URL 프록시가 불가능하다.
 *
 * <h2>⚠️ 이 표면은 Data 쪽에 아직 없다</h2>
 * 최신 main({@code 69d05f873})의 {@code server/data-api} 에는 {@code /internal/*} 컨트롤러가
 * <b>한 건도 없다</b>(실제 확인: {@code grep -rn "/internal" server/data-api/src/main/java} → 0건).
 * 여기 적힌 경로·스키마는 {@code docs/contracts/business-satellite-api.yaml} 로 제안한 계약이고,
 * <b>Data 구현이 붙기 전에는 이 클라이언트가 런타임에 404 를 받는다</b> — 그 404 는 도메인 코드가 없어
 * {@code UpstreamContractMismatchException}(502)으로 올라간다. 테스트의 mock 성공이 이 사실을
 * 감추지 않도록, mock 은 «계약대로 응답하는 상류»를 세우는 데만 쓴다.
 */
public class DataApiClient {

    private static final String PATH_ACTIVATION = "/internal/users/{userId}/activation";
    private static final String PATH_DEVICE_SESSION_VERIFY = "/internal/auth/device-sessions/verify";
    private static final String PATH_DEVICE_TOKEN_DELETIONS = "/internal/users/{userId}/device-token-deletions";
    private static final String PATH_NOTIFICATION_SETTINGS_COMMANDS =
            "/internal/users/{userId}/notification-settings-commands";
    private static final String PATH_COMMAND_DELIVERED = "/internal/outbox-commands/{commandId}/delivered";
    private static final String PATH_INVITE_ISSUE_CONTEXT = "/internal/groups/{groupId}/invite-issue-context";
    private static final String PATH_CLAIM_INTENTS = "/internal/invite-links/claim-intents";
    private static final String PATH_CLAIM_CONFIRMATIONS = "/internal/invite-links/claim-confirmations";
    private static final String PATH_RESULT_CLAIM = "/internal/users/{userId}/challenge-results/{sessionId}/claim";
    private static final String PATH_RESULT_ACK = "/internal/users/{userId}/challenge-results/{sessionId}/ack";
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

    public DataApiClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 위성 쓰기 전 활성 검사 (A22 ⓖ). 멱등 GET 이라 재시도한다.
     *
     * <p><b>실패를 「비활성」으로 접지 않는다</b> — 그러면 Data 장애가 「전원 탈퇴」라는 조용한 차단이
     * 되어 설정 변경·기기 등록이 전부 막힌다. 판정 불가는 503 으로 올라간다.
     */
    public UserActivation checkActivation(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_ACTIVATION.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<UserActivation>() { });
    }

    /**
     * {@code deviceBootstrap} 세션 활성 확인 + {@code sessionEpoch} fencing (A22 ㋤ · ㋨).
     *
     * <p>POST 지만 <b>상태를 바꾸지 않는 확인</b>이라 재시도해도 안전하다. GET 이 아닌 이유는 자격
     * 문자열을 쿼리에 실으면 접근 로그·프록시 캐시에 남기 때문이다.
     */
    public DeviceSessionCheck verifyDeviceSession(UUID userId, String deviceBootstrap, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_DEVICE_SESSION_VERIFY)
                        .onBehalfOf(userId)
                        .body(Map.of("deviceBootstrap", deviceBootstrap))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DeviceSessionCheck>() { });
    }

    /**
     * 기기 토큰 삭제 outbox 를 <b>직접 삭제 「전에」</b> 기록한다 (A22 ㊲ · ㊿ · ㊨ · ㊪).
     *
     * <p>순서를 뒤집으면(실패 후에야 기록) 그 사이 프로세스가 죽을 때 직접 삭제도 outbox 도 남지 않고,
     * 앱은 이 DELETE 실패를 삼키고 로컬 인증을 지우므로 <b>아무도 재시도하지 않고 이전 계정 푸시가
     * 그 기기로 계속 간다</b>.
     *
     * @param deviceToken     대상 FCM 토큰 — {@code X-Device-Token} 으로 받은 값(㊪). 없으면 outbox 를
     *                        계약대로 만들 수 없다
     * @param ownershipToken  {@code X-Device-Ownership} 으로 받은 CAS 값(㊚). 롤아웃 기간엔 null 가능
     * @param authGeneration  AT 의 {@code gen} claim. <b>없으면 null 그대로</b> 보낸다(㊍)
     */
    public DurableCommandAck recordDeviceTokenDeletion(UUID userId, String deviceToken, String ownershipToken,
            Long authGeneration, String idempotencyKey, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_DEVICE_TOKEN_DELETIONS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(new DeviceTokenDeletionCommand(deviceToken, ownershipToken, authGeneration))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
    }

    /**
     * 알림 설정 변경을 <b>Data 에 먼저 내구 저장</b>한다 (A22 ㊷ · ㋕ · §3).
     *
     * <p>동기 호출만으로 끝내면 알림 서버 장애가 공통 재시도보다 길 때 변경이 영구 유실되는데,
     * 앱은 {@code NotificationSettingsScreen.tsx:142-148} 에서 <b>화면을 먼저 바꾼 뒤 서버 오류를 삼키고
     * 「다음 변경 때」까지 재시도하지 않는다</b> — 사용자는 껐다고 보는데 정본은 계속 true 라 푸시가
     * 무기한 간다. 그래서 Data outbox(relay 가 재전달)를 먼저 만든다.
     *
     * <p>응답의 {@code version} 이 <b>역순 적용을 막는 유일한 값</b>이다(㋕) — 「끔」이 알림엔 성공했지만
     * 완료 표시만 실패하고 뒤이은 「켬」이 끝까지 성공하면, relay 가 남은 「끔」을 나중에 적용해 사용자가
     * 켠 설정을 도로 끈다.
     */
    public DurableCommandAck recordNotificationSettings(UUID userId, Object settings, String idempotencyKey,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PUT,
                                PATH_NOTIFICATION_SETTINGS_COMMANDS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(settings)
                        // 전체 교체 PUT 이라 멱등이다(§4 의 재시도 대상).
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
    }

    /**
     * 직접 전달이 성공했으니 그 outbox 행을 완료 표시한다 (㊿ 의 「빠른 경로」).
     *
     * <p><b>이 호출이 실패해도 사용자 요청을 실패시키지 않는다</b> — relay 가 한 번 더 보낼 뿐이고,
     * 위성의 멱등·version 규칙이 중복 적용을 흡수한다. 반대로 여기서 실패를 올리면 이미 반영된 변경이
     * 사용자에게 오류로 보인다.
     */
    public void markCommandDelivered(UUID userId, UUID commandId, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, PATH_COMMAND_DELIVERED.replace("{commandId}", commandId.toString()))
                        .onBehalfOf(userId)
                        .idempotentCommand()
                        .build(),
                deadline);
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
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_CLAIM_INTENTS)
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(Map.of("slug", slug))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ClaimIntentAck>() { });
    }

    /**
     * 링크가 만든 <b>잠정(pending) claim</b> 을 Data 의 멤버십 락 아래에서 확정한다 (A22 ㋟).
     *
     * <p>확정 전달은 <b>Business 가 링크를 직접 호출하지 않는다</b> — Data 가 락 아래
     * {@code link.claimConfirmed} outbox 를 기록하고 relay 가 전달한다. 락을 잡은 채 외부 호출은 §3
     * 위반이고, 락이 풀린 뒤 Business 가 보내면 그 사이 revoke 가 끼어든다.
     *
     * @param capability 링크 서버가 서명한 자격(slug · groupId · inviterId · membershipEpoch · 만료).
     *                   Data 가 <b>커밋 안에서</b> 현재 그룹 상태·멤버십 epoch 와 대조한다(ⓚ)
     */
    public DurableCommandAck confirmClaim(UUID userId, UUID claimId, String slug, String capability,
            String idempotencyKey, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_CLAIM_CONFIRMATIONS)
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(new ClaimConfirmationCommand(claimId, slug, capability))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
    }

    /**
     * 결과 표시 선점 — 알림 서버가 끼지 않는다. 조건부 원자 UPDATE 라 <b>재시도하지 않는다</b>:
     * 최초 획득은 멱등이 아니고(두 번째 시도가 남의 리스를 가져올 수 있다) 실패 응답이 계약이다
     * ({@code RESULT_CLAIM_HELD} + {@code retryAfterMs}).
     */
    public Object claimResultDisplay(UUID userId, UUID sessionId, UUID currentToken, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, resultPath(PATH_RESULT_CLAIM, userId, sessionId))
                        .onBehalfOf(userId)
                        .body(Map.of("claimToken", currentToken == null ? "" : currentToken.toString()))
                        .build(),
                deadline,
                new ParameterizedTypeReference<Object>() { });
    }

    /**
     * 결과 확인(ack) 커밋 — 2단계의 <b>가운데</b>다 (A22 ⓓ). 앞에 알림 prepare, 뒤에 알림 commit 이 온다.
     *
     * <p>재시도하지 않는다: {@code acknowledged_at IS NULL} 조건부 UPDATE 라 두 번째 시도는 0행이 되고,
     * 그 0행을 실패로 읽으면 이미 성공한 ack 가 실패로 보고된다.
     */
    public void acknowledgeResult(UUID userId, UUID sessionId, UUID claimToken, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, resultPath(PATH_RESULT_ACK, userId, sessionId))
                        .onBehalfOf(userId)
                        .body(Map.of("claimToken", claimToken == null ? "" : claimToken.toString()))
                        .build(),
                deadline);
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
        http.execute(
                InternalCall.to(HttpMethod.POST,
                                PATH_CLAIM_INTENT_COMPLETED.replace("{commandId}", commandId.toString()))
                        .body(Map.of("leaseToken", leaseToken.toString()))
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
     * <p><b>{@link #markCommandDelivered} 로 닫을 수 없다.</b> 그쪽은 봉투의 {@code eventId} 로
     * 「알림 대상 전달」을 닫는 경로이고 claim 의도는 outbox 행이 아니다 — 의도 id 를 그 경로에 보내면
     * <b>항상 404</b> 다. 반대로 {@code …/completed} 는 lease 를 쥔 <b>서비스 전용</b> 재개 표면이라
     * 요청 경로가 빌려 쓰면 임의 의도를 선점·완료할 권한이 생긴다.
     *
     * <p>이미 종결된 의도에 다시 와도 200 이다(멱등). 이 호출의 실패는 사용자 요청을 실패시키지
     * 않는다 — 남은 의도는 재개 CLI 가 한 번 더 밟고, 그쪽도 같은 「붙일 대상 없음」으로 종결한다.
     */
    public void abandonClaimIntent(UUID userId, UUID commandId, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST,
                                PATH_CLAIM_INTENT_ABANDONED.replace("{commandId}", commandId.toString()))
                        .onBehalfOf(userId)
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    private String resultPath(String template, UUID userId, UUID sessionId) {
        return template.replace("{userId}", userId.toString()).replace("{sessionId}", sessionId.toString());
    }

    /** 삭제 outbox 요청 본문. {@code authGeneration} 은 <b>없으면 null</b> 이고 채우지 않는다(㊍). */
    record DeviceTokenDeletionCommand(String deviceToken, String ownershipToken, Long authGeneration) {
    }

    /** claim 확정 요청 본문. */
    record ClaimConfirmationCommand(UUID claimId, String slug, String capability) {
    }
}

package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.FocusFinish;
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.FocusSummary;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 집중 세션 수명주기 6종의 위임 (GROMO-1764). 상태·시간·정산은 전부 Data 가 판정한다 —
 * Business 는 세션 주체를 AT 에서만 꺼내 전달하고, 도메인 실패를 공개 오류 표로 옮긴다.
 *
 * <p>주체는 <b>언제나 {@link AccessTokenClaims#userId()}</b> 다. 경로·본문으로 userId 를 받지 않으므로
 * 「남의 세션을 조작하는」 입력 자체가 존재하지 않는다.
 */
@Service
@RequiredArgsConstructor
public class FocusSessionUseCase {

    /**
     * Data 의 도메인 판정 → 공개 오류. 여기 없는 코드는 그대로 올려 보내고 전역 핸들러가
     * 「등록되지 않은 상류 계약」(502)으로 접는다 — 모르는 판정을 그럴듯한 4xx 로 위장하지 않는다.
     *
     * <p>{@code SESSION_STATE_CONFLICT} 를 {@code VERSION_CONFLICT} 가 아니라 {@code STATE_CONFLICT} 로
     * 옮기는 것은 의도다: Data 가 lifecycle 불일치와 expectedVersion 불일치를 한 코드로 합쳐 두어
     * 여기서는 둘을 구분할 수 없다. 구분이 필요해지면 Data 가 코드를 먼저 나눠야 한다.
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("INVALID_SUBJECT", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "subject")),
            Map.entry("INVALID_TARGET_MINUTES",
                    new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "targetMinutes")),
            Map.entry("ISLAND_NOT_CURRENT", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("ISLAND_MEMBERSHIP_REQUIRED", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("SESSION_IN_PROGRESS", new PublicFailure(ApiErrorCode.STATE_CONFLICT, null)),
            Map.entry("EXPECTED_VERSION_REQUIRED",
                    new PublicFailure(ApiErrorCode.INVALID_REQUEST, "expectedVersion")),
            Map.entry("SESSION_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "sessionId")),
            Map.entry("FORBIDDEN", new PublicFailure(ApiErrorCode.FORBIDDEN, null)),
            Map.entry("SESSION_STATE_CONFLICT", new PublicFailure(ApiErrorCode.STATE_CONFLICT, null)),
            Map.entry("REWARD_POLICY_UNAVAILABLE", new PublicFailure(ApiErrorCode.SERVICE_UNAVAILABLE, null)),
            Map.entry("INVALID_SUMMARY_DATE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "date")),
            Map.entry("SUMMARY_DATE_OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, "date")),
            Map.entry("INVALID_SUMMARY_TIMEZONE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "timezone")));

    private final DataApiClient data;

    public FocusSessionState start(AccessTokenClaims claims, UUID islandId, String subject, int targetMinutes,
            UUID key, Deadline deadline) {
        return relay(() -> data.startFocusSession(claims.userId(), islandId, subject, targetMinutes, key, deadline));
    }

    /** 진행 세션이 없으면 {@code null} 이고, 그 null 은 정상값이다 — 공개 응답의 {@code data:null} 이 된다. */
    public FocusSessionState current(AccessTokenClaims claims, Deadline deadline) {
        return relay(() -> data.fetchCurrentFocusSession(claims.userId(), deadline)).session();
    }

    public FocusSessionState pause(AccessTokenClaims claims, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return relay(() -> data.pauseFocusSession(claims.userId(), sessionId, expectedVersion, key, deadline));
    }

    public FocusSessionState resume(AccessTokenClaims claims, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return relay(() -> data.resumeFocusSession(claims.userId(), sessionId, expectedVersion, key, deadline));
    }

    public FocusFinish finish(AccessTokenClaims claims, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return relay(() -> data.finishFocusSession(claims.userId(), sessionId, expectedVersion, key, deadline));
    }

    public FocusSummary summary(AccessTokenClaims claims, String date, String timezone, Deadline deadline) {
        return relay(() -> data.fetchFocusSummary(claims.userId(), date, timezone, deadline));
    }

    private <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e);
        }
    }

    private RuntimeException mapped(UpstreamDomainException error) {
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    /** 공개 오류 한 줄 — 코드와 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(ApiErrorCode code, String field) {
    }
}

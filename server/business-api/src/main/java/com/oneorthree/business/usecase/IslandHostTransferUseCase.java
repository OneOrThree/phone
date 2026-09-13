package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.upstream.data.DataApiClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/** Data가 원자 확정한 위임 결과만 공개한다. Business에서 이벤트를 중복 발행하지 않는다. */
@Service
@RequiredArgsConstructor
public class IslandHostTransferUseCase {

    private final DataApiClient data;

    public Result transfer(AccessTokenClaims claims, UUID islandId, UUID targetUserId, UUID key, Deadline deadline) {
        JsonNode response;
        try {
            response = data.transferIslandHost(claims.userId(), claims.sessionId(), claims.authGeneration(),
                    islandId, targetUserId, key, deadline);
        } catch (UpstreamDomainException e) {
            throw mapped(e);
        }
        if (response == null || !response.isObject()) {
            throw invalid();
        }
        JsonNode host = response.get("hostUserId");
        JsonNode version = response.get("version");
        if (host == null || !host.isString() || version == null || !version.isIntegralNumber()
                || !version.canConvertToLong() || version.longValue() <= 0
                || version.longValue() > ResourceVersions.MAX_SAFE_INTEGER) {
            throw invalid();
        }
        try {
            String raw = host.stringValue();
            UUID actual = UUID.fromString(raw);
            if (raw.length() != 36 || !actual.toString().equalsIgnoreCase(raw) || !actual.equals(targetUserId)) {
                throw invalid();
            }
            return new Result(actual, version.longValue());
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
    }

    private RuntimeException mapped(UpstreamDomainException error) {
        String code = error.getCode();
        int status = error.getStatus();
        if (status == 503 && "REALTIME_NOT_READY".equals(code)) {
            return new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        if (status == 409 && "CANNOT_TRANSFER_SELF".equals(code)) {
            return new PublicApiException(ApiErrorCode.STATE_CONFLICT, "targetUserId");
        }
        if (status == 403 && "NOT_OWNER".equals(code)) {
            return new PublicApiException(ApiErrorCode.FORBIDDEN, null);
        }
        if (status == 403 && "SESSION_NOT_ACTIVE".equals(code)) {
            return new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
        }
        if (status == 404 && ("TARGET_USER_NOT_FOUND".equals(code) || "NOT_FOUND".equals(code))) {
            return new PublicApiException(ApiErrorCode.NOT_FOUND, "targetUserId");
        }
        if (status == 404 && "GROUP_NOT_FOUND".equals(code)) {
            return new PublicApiException(ApiErrorCode.GROUP_NOT_FOUND, "islandId");
        }
        return error;
    }

    private static UpstreamContractMismatchException invalid() {
        return new UpstreamContractMismatchException("방장 위임 응답 계약 불일치");
    }

    public record Result(UUID hostUserId, long version) {
    }
}

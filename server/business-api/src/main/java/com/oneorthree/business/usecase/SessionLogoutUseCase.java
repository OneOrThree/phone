package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** 해당 세션 폐기만 처리한다. 기기 등록 삭제나 사용자 전체 로그아웃을 수행하지 않는다. */
@Service
@RequiredArgsConstructor
public class SessionLogoutUseCase {

    private final DataApiClient data;

    public Result logout(LogoutCredentials credentials, Deadline deadline) {
        JsonNode response;
        try {
            response = data.logoutSession(credentials, deadline);
        } catch (UpstreamDomainException e) {
            if (e.getStatus() == 401 && "REFRESH_TOKEN".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.REFRESH_TOKEN, null);
            }
            if (e.getStatus() == 401 && "UNAUTHORIZED".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
            }
            if (e.getStatus() == 404 && "USER_NOT_FOUND".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.USER_NOT_FOUND, null);
            }
            throw e;
        }
        if (response == null || !response.isObject() || !response.has("revoked")
                || !response.get("revoked").isBoolean() || !response.get("revoked").booleanValue()) {
            throw new UpstreamContractMismatchException("Data 로그아웃 완료 응답 계약 불일치");
        }
        return new Result(true);
    }

    public record Result(boolean revoked) {
    }
}

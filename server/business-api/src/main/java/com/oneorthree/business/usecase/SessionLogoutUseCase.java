package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.auth.RevokedSessions;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataAuthClient;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/** 해당 세션 폐기만 처리한다. 기기 등록 삭제나 사용자 전체 로그아웃을 수행하지 않는다. */
@Slf4j
@Service
@RequiredArgsConstructor
public class SessionLogoutUseCase {

    private final DataAuthClient data;
    private final RevokedSessions revokedSessions;

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
        revokeSession(response.get("sessionId"));
        return new Result(true);
    }

    /** 로그아웃은 이미 Data 에 커밋됐다 — 거부목록 기록 실패로 실패처럼 보이게 하지 않는다. sessionId 없는 구 Data 는 건너뛴다. */
    private void revokeSession(JsonNode node) {
        if (node == null || !node.isString()) {
            return;
        }
        try {
            revokedSessions.revoke(UUID.fromString(node.stringValue()));
        } catch (RuntimeException e) {
            log.warn("로그아웃 세션 거부목록 기록 실패 — 해당 AT 는 만료까지 유효하다", e);
        }
    }

    @Schema(name = "SessionLogoutResult")
    public record Result(boolean revoked) {
    }
}

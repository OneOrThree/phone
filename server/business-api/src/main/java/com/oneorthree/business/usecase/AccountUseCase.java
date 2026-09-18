package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.AccountMe;
import com.oneorthree.business.upstream.data.dto.AccountProfile;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.util.UUID;
import java.util.function.Supplier;

/**
 * 공개 계정 3종 {@code GET|PATCH|DELETE /me} (GROMO-1801 · 계정 LLD §2.2·§2.3·§2.5).
 *
 * <p>사용자 활성·세션·세대·닉네임·방장 판정은 전부 Data TX 가 한다. 여기서 옮기는 것은 Data 의 세션 폐기
 * 403 {@code SESSION_NOT_ACTIVE} → 공개 401 하나뿐이고, 나머지({@code USER_NOT_FOUND}·{@code NICKNAME_*}·
 * {@code HOST_WITHDRAW}·키 충돌)는 이름이 같은 공개 코드로 {@code registeredUpstream} 이 옮긴다.
 *
 * <p>ponytail: 탈퇴 전 Business 링크 미리보기 캐시 차단 표지·삭제(LLD §4)는 하지 않는다 — 별도 후속이다.
 */
@Service
@RequiredArgsConstructor
public class AccountUseCase {

    private final DataApiClient data;

    public AccountMe me(AccessTokenClaims claims, Deadline deadline) {
        AccountMe me = relay(() -> data.fetchAccount(claims.userId(), claims.sessionId(),
                claims.authGeneration(), deadline));
        if (me == null || !claims.userId().equals(me.id())) {
            throw invalid();
        }
        return me;
    }

    public AccountProfile rename(AccessTokenClaims claims, String name, UUID key, Deadline deadline) {
        AccountProfile profile = relay(() -> data.patchAccount(claims.userId(), claims.sessionId(),
                claims.authGeneration(), name, key, deadline));
        if (profile == null || !claims.userId().equals(profile.id())) {
            throw invalid();
        }
        return profile;
    }

    public Deleted withdraw(AccessTokenClaims claims, Deadline deadline) {
        JsonNode response = relay(() -> data.deleteAccount(claims.userId(), claims.sessionId(),
                claims.authGeneration(), deadline));
        JsonNode deleted = response == null ? null : response.get("deleted");
        if (deleted == null || !deleted.isBoolean() || !deleted.booleanValue()) {
            throw invalid();
        }
        return new Deleted(true);
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            if (e.getStatus() == 403 && "SESSION_NOT_ACTIVE".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
            }
            throw e;
        }
    }

    private static UpstreamContractMismatchException invalid() {
        return new UpstreamContractMismatchException("계정 응답 계약 불일치");
    }

    /** 탈퇴 성공 {@code {"deleted": true}} — legacy DELETE 의 204 와 구분한다(LLD §2.5). */
    public record Deleted(boolean deleted) {
    }
}

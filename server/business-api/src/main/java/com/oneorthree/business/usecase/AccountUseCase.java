package com.oneorthree.business.usecase;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.linkpreview.repository.PreviewCache;
import com.oneorthree.business.upstream.data.DataAuthClient;
import com.oneorthree.business.upstream.data.dto.AccountMe;
import com.oneorthree.business.upstream.data.dto.AccountProfile;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 공개 계정 3종 {@code GET|PATCH|DELETE /me} (GROMO-1801 · 계정 LLD §2.2·§2.3·§2.5).
 *
 * <p>사용자 활성·세션·세대·닉네임·방장·섬 주민 판정은 전부 Data TX 가 한다. 여기서 옮기는 것은 Data 의 세션 폐기
 * 403 {@code SESSION_NOT_ACTIVE} → 공개 401, PATCH 스위치 503 {@code PROFILE_UPDATE_UNAVAILABLE} → 공개 503,
 * 비주민 섬 403 {@code MEMBER_ONLY} → 공개 403 {@code FORBIDDEN} 셋이고, 나머지({@code USER_NOT_FOUND}·
 * {@code NICKNAME_*}·{@code HOST_WITHDRAW}·키 충돌)는 이름이 같은 공개 코드로 {@code registeredUpstream} 이 옮긴다.
 *
 * <p>탈퇴가 확정되면 Business 링크 미리보기 캐시의 차단 표지·삭제(LLD §4)를 여기서 한다(GROMO-1943) —
 * Data→Business 전달이 없으므로 탈퇴 요청이 지나가는 이 자리가 Business 쪽 {@code user.withdrawn} 소비자다.
 * ponytail: 표지를 «Data 호출 뒤»에 놓는다. 호출 전에 놓으면 확정 실패(HOST_WITHDRAW 등) 때 해제가 필요하고,
 * 그 해제가 재시도(이미 탈퇴 → 404)와 구분되지 않는다. 커밋~표지 사이 수 ms 에 생긴 키도 표지 뒤 SCAN 이 지운다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountUseCase {

    private final DataAuthClient data;
    private final PreviewCache previewCache;

    public AccountView me(AccessTokenClaims claims, Deadline deadline) {
        AccountMe me = relay(() -> data.fetchAccount(claims.userId(), claims.sessionId(),
                claims.authGeneration(), deadline));
        if (me == null || !claims.userId().equals(me.id())) {
            throw invalid();
        }
        return new AccountView(me.id(), me.name(), me.catColor(), me.mainIslandId(),
                me.linkedProviders(), me.onboardingComplete());
    }

    public ProfileView updateProfile(AccessTokenClaims claims, String name, String catColor, UUID mainIslandId,
                                        UUID key, Deadline deadline) {
        AccountProfile profile = relay(() -> data.patchAccount(claims.userId(), claims.sessionId(),
                claims.authGeneration(), name, catColor, mainIslandId, key, deadline));
        if (profile == null || !claims.userId().equals(profile.id())) {
            throw invalid();
        }
        return new ProfileView(profile.id(), profile.name(), profile.catColor(), profile.mainIslandId());
    }

    public Deleted withdraw(AccessTokenClaims claims, Deadline deadline) {
        JsonNode response = relay(() -> data.deleteAccount(claims.userId(), claims.sessionId(),
                claims.authGeneration(), deadline));
        JsonNode deleted = response == null ? null : response.get("deleted");
        if (deleted == null || !deleted.isBoolean() || !deleted.booleanValue()) {
            throw invalid();
        }
        try {
            previewCache.eraseUser(claims.userId().toString());
        } catch (RuntimeException e) {
            // 탈퇴는 이미 Data 에 커밋됐다 — 사본 정리 실패로 탈퇴를 실패처럼 보이게 하지 않는다.
            // 남은 키는 TTL(최대 300초)로 사라진다. 표지가 없으니 남은 AT 수명 동안은 새 사본이 생길 수 있다.
            log.warn("탈퇴 미리보기 캐시 정리 실패 — userId={}", claims.userId(), e);
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
            // PATCH 비상 스위치가 닫힘(계정 LLD §2.3). 사유는 내부 코드로만 남긴다.
            if (e.getStatus() == 503 && "PROFILE_UPDATE_UNAVAILABLE".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
            }
            // 주민이 아닌 섬을 메인 섬으로 고름(GROMO-1971). 이름이 같은 공개 코드가 없어
            // registeredUpstream 이 못 옮기는데, 안 옮기면 «정상적인 403 이 502 로» 나간다.
            if (e.getStatus() == 403 && "MEMBER_ONLY".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.FORBIDDEN, "mainIslandId");
            }
            throw e;
        }
    }

    private static UpstreamContractMismatchException invalid() {
        return new UpstreamContractMismatchException("계정 응답 계약 불일치");
    }

    /** 공개 계정 조회 필드. 내부 전송 DTO의 필드 추가가 공개 응답을 확장하지 않도록 명시적으로 조립한다. */
    public record AccountView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) String catColor,
            @JsonProperty(required = true) UUID mainIslandId,
            @JsonProperty(required = true) List<String> linkedProviders,
            @JsonProperty(required = true) boolean onboardingComplete) {
    }

    /** 공개 프로필 변경 결과. DB 컬럼·내부 인증 상태를 포함하지 않는다. */
    public record ProfileView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) String catColor,
            @JsonProperty(required = true) UUID mainIslandId) {
    }

    /** 탈퇴 성공 {@code {"deleted": true}} — legacy DELETE 의 204 와 구분한다(LLD §2.5). */
    public record Deleted(boolean deleted) {
    }
}

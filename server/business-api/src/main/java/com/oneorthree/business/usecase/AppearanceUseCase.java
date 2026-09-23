package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.api.PublicCurrentState;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataAppearanceClient;
import com.oneorthree.business.upstream.data.dto.IslandAppearancePatchResult;
import com.oneorthree.business.upstream.data.dto.IslandAppearanceState;
import com.oneorthree.business.upstream.data.dto.PersonalAppearancePatchResult;
import com.oneorthree.business.upstream.data.dto.PersonalAppearanceState;
import com.oneorthree.business.upstream.data.dto.PersonalInventory;
import com.oneorthree.business.upstream.data.dto.SharedInventory;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 보유품·외양 4종의 공개 유스케이스 (GROMO-1783, island-appearance LLD §3~§5).
 *
 * <p>소유권·kind·대상 건물·권한·버전 비교는 전부 Data TX 가 판정한다 — Business 는 strict
 * 세션의 주체와 tri-state 캐리어만 넘기고, 도메인 실패를 공개 오류 표로 옮긴다. 등록되지 않은
 * 판정은 그대로 올려 {@code registeredUpstream} 이 502 로 접는다(건설 유스케이스와 같은 규칙).
 */
@Service
@RequiredArgsConstructor
public class AppearanceUseCase {

    private static final String FIELD_VERSION = "expectedVersion";

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            // 비주민 — 두 섬 API 공통 소속 게이트다.
            Map.entry("MEMBER_ONLY", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            // SHARED_APPEARANCE — 활성 주민이지만 방장이 아니다.
            Map.entry("NOT_OWNER", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            // 미보유 상품 적용 — 개인·공동 모두 같은 공개 코드다.
            Map.entry("FORBIDDEN", new PublicFailure(ApiErrorCode.FORBIDDEN, null)),
            Map.entry("PRODUCT_NOT_FOUND", new PublicFailure(ApiErrorCode.PRODUCT_NOT_FOUND, null)),
            Map.entry("INVALID_REQUEST", new PublicFailure(ApiErrorCode.INVALID_REQUEST, null)),
            // 등록됐지만 종류·소유자·대상이 다르거나 null 불가 슬롯의 null·미등록 건물 키.
            Map.entry("OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, null)));

    private final DataAppearanceClient data;

    /** 개인 인벤토리 (LLD §3 GET /me/inventory). */
    public PersonalInventory myInventory(AccessTokenClaims claims, Deadline deadline) {
        PersonalInventory inventory = relay(
                () -> data.fetchMyInventory(claims.userId(), deadline), claims, null);
        if (inventory == null) {
            throw new UpstreamContractMismatchException("개인 인벤토리 응답이 없습니다");
        }
        return inventory;
    }

    /**
     * 개인 외양 적용 (LLD §4 PATCH /me/appearance). 같은 키·본문은 Data 의 확정 receipt 재생이다.
     * 공개 응답은 내부 결과의 {@code data} 뿐 — events 는 realtime relay 의 몫이다.
     */
    public PersonalAppearanceState patchMine(AccessTokenClaims claims, List<String> fields,
            Map<String, Object> values, UUID key, Deadline deadline) {
        PersonalAppearancePatchResult result = relay(
                () -> data.patchMyAppearance(claims.userId(), fields, values, key, deadline),
                claims, null);
        if (result == null || result.data() == null) {
            throw new UpstreamContractMismatchException("개인 외양 응답이 계약과 다릅니다");
        }
        return result.data();
    }

    /** 공동 인벤토리 (LLD §3 GET /islands/{islandId}/inventory). */
    public SharedInventory islandInventory(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        SharedInventory inventory = relay(
                () -> data.fetchIslandInventory(islandId, claims.userId(), deadline), claims, islandId);
        if (inventory == null) {
            throw new UpstreamContractMismatchException("공동 인벤토리 응답이 없습니다");
        }
        return inventory;
    }

    /**
     * 공동 외양 적용 (LLD §4 PATCH /islands/{islandId}/appearance). VERSION_CONFLICT 는
     * 허용된 409 라 현재 스냅샷을 current 로 단다 — 재조회마저 실패하면 지목 근거가 없어
     * current 없이 충돌만 남긴다(건설과 같은 규칙).
     */
    public IslandAppearanceState patchIsland(AccessTokenClaims claims, UUID islandId,
            List<String> fields, Map<String, Object> values, long expectedVersion, UUID key,
            Deadline deadline) {
        IslandAppearancePatchResult result;
        try {
            result = data.patchIslandAppearance(islandId, claims.userId(), fields, values,
                    expectedVersion, key, deadline);
        } catch (UpstreamDomainException e) {
            throw mapped(e, claims, islandId, deadline);
        }
        if (result == null || result.data() == null) {
            throw new UpstreamContractMismatchException("공동 외양 응답이 계약과 다릅니다");
        }
        return result.data();
    }

    private <T> T relay(Supplier<T> upstream, AccessTokenClaims claims, UUID islandId) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e, claims, islandId, null);
        }
    }

    private RuntimeException mapped(UpstreamDomainException error, AccessTokenClaims claims,
            UUID islandId, Deadline deadline) {
        // 버전 충돌은 공동 명령 경로에서만 current 를 단다 — 「허용된 409 에만 top-level current」(LLD §3).
        if (error.getStatus() == 409 && "VERSION_CONFLICT".equals(error.getCode())
                && islandId != null && deadline != null) {
            return versionConflict(claims, islandId, deadline);
        }
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    /** 409 의 최신 공개 상태 — 공동 인벤토리의 appearance 를 같은 세션 주체로 한 번 더 읽는다. */
    private RuntimeException versionConflict(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        IslandAppearanceState current;
        try {
            SharedInventory inventory = data.fetchIslandInventory(islandId, claims.userId(), deadline);
            current = inventory == null ? null : inventory.appearance();
        } catch (RuntimeException e) {
            current = null;
        }
        if (current == null) {
            return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, FIELD_VERSION);
        }
        return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, FIELD_VERSION,
                new PublicCurrentState(current.version(), current));
    }

    /** 공개 오류 한 줄 — 코드와 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(ApiErrorCode code, String field) {
    }
}

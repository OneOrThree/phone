package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.api.PublicCurrentState;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataConstructionClient;
import com.oneorthree.business.upstream.data.dto.ConstructionOptions;
import com.oneorthree.business.upstream.data.dto.ConstructionResult;
import com.oneorthree.business.upstream.data.dto.ConstructionTarget;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 섬 건설 3종의 공개 유스케이스 (GROMO-1767, island-construction LLD §2~§4).
 *
 * <p>권한·잔액·버전 비교·차감은 전부 Data TX 가 판정한다 — Business 는 strict 세션의 주체만
 * 넘기고, 도메인 실패를 공개 오류 표로 옮긴다. 등록되지 않은 판정은 그대로 올려
 * {@code registeredUpstream} 이 동명 공개 코드로 옮기거나 502 로 접는다(GROMO-1759 선례).
 *
 * <p>{@code REQUEST_IN_PROGRESS}·{@code IDEMPOTENCY_KEY_CONFLICT} 는 표에 두지 않는다 —
 * 이름·상태가 공개 계약과 이미 같아 그대로 올라가는 편이 {@code Retry-After} 값을 보존한다.
 */
@Service
@RequiredArgsConstructor
public class IslandConstructionUseCase {

    private static final String STATUS_BUILDING = "BUILDING";
    private static final String FIELD_VERSION = "expectedVersion";
    private static final String FIELD_COST_VERSION = "expectedCostPolicyVersion";

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            // 비주민 — GET 도 포함하는 모든 API 공통 소속 게이트다(LLD §3).
            Map.entry("MEMBER_ONLY", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            // 건설 권한(SHARED_PURCHASE) 없음 — 목표 선택·건설하기는 방장만이다(C13·GROMO-2000).
            Map.entry("CONSTRUCTION_FORBIDDEN", new PublicFailure(ApiErrorCode.FORBIDDEN, null)),
            // 목표 선택의 게시판 미해금.
            Map.entry("FACILITY_LOCKED", new PublicFailure(ApiErrorCode.FACILITY_LOCKED, null)),
            // Data 의 bean 검증 거절 — 시설 id 규칙의 정의는 Data 에만 있다.
            Map.entry("INVALID_REQUEST", new PublicFailure(ApiErrorCode.INVALID_REQUEST, null)),
            // 미지원 시설 id·범위 위반.
            Map.entry("OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, "buildingId")),
            // 이미 완료이거나 선행 시설이 없다.
            Map.entry("STATE_CONFLICT", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "buildingId")),
            Map.entry("INSUFFICIENT_FUNDS",
                    new PublicFailure(ApiErrorCode.INSUFFICIENT_FUNDS, "buildingId")),
            Map.entry("CONCURRENT_UPDATE", new PublicFailure(ApiErrorCode.VERSION_CONFLICT, null)));

    private final DataConstructionClient data;

    /** 건설 옵션 스냅샷 (LLD §2 GET). */
    public ConstructionOptions options(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        ConstructionOptions options = relay(
                () -> data.fetchConstructionOptions(claims.userId(), islandId, deadline),
                claims, null, null, null, deadline);
        if (options == null) {
            throw new UpstreamContractMismatchException("건설 옵션 응답이 없습니다");
        }
        return options;
    }

    /** 건설 목표 선택 (LLD §2 PUT). 같은 키·본문은 Data 의 확정 receipt 재생이다. */
    public ConstructionTarget selectTarget(AccessTokenClaims claims, UUID islandId, String buildingId,
            long expectedVersion, UUID key, Deadline deadline) {
        ConstructionTarget target = relay(
                () -> data.selectConstructionTarget(claims.userId(), islandId, buildingId,
                        expectedVersion, key, deadline),
                claims, islandId, expectedVersion, null, deadline);
        if (target == null) {
            throw new UpstreamContractMismatchException("건설 목표 선택 응답이 없습니다");
        }
        return target;
    }

    /**
     * 건설 명령 (LLD §2 POST).
     *
     * <p>승인 정책상 성공 상태는 {@code "BUILDING"} 하나다 — 공사 시간이 있는 동안 완공이 아니다.
     * 다른 상태는 이 계약의 응답이 아니므로 조용히 넘기지 않고 계약 불일치(502)로 접는다.
     */
    public ConstructionResult build(AccessTokenClaims claims, UUID islandId, String buildingId,
            long expectedVersion, long expectedCostPolicyVersion, UUID key, Deadline deadline) {
        ConstructionResult result = relay(
                () -> data.startConstruction(claims.userId(), islandId, buildingId, expectedVersion,
                        expectedCostPolicyVersion, key, deadline),
                claims, islandId, expectedVersion, expectedCostPolicyVersion, deadline);
        if (result == null || !STATUS_BUILDING.equals(result.status())) {
            throw new UpstreamContractMismatchException("건설 명령 응답 상태가 계약과 다릅니다");
        }
        return result;
    }

    private <T> T relay(Supplier<T> upstream, AccessTokenClaims claims, UUID islandId,
            Long expectedVersion, Long expectedCostPolicyVersion, Deadline deadline) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e, claims, islandId, expectedVersion, expectedCostPolicyVersion, deadline);
        }
    }

    private RuntimeException mapped(UpstreamDomainException error, AccessTokenClaims claims,
            UUID islandId, Long expectedVersion, Long expectedCostPolicyVersion, Deadline deadline) {
        // 버전 충돌은 명령 경로에서만 current 를 단다 — LLD §3 「허용된 409 에만 top-level current」.
        if (error.getStatus() == 409 && "VERSION_CONFLICT".equals(error.getCode()) && islandId != null) {
            return versionConflict(claims, islandId, expectedVersion, expectedCostPolicyVersion, deadline);
        }
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    /**
     * 409 의 최신 공개 상태 — options 를 같은 세션 주체로 한 번 더 읽어 current 를 채운다.
     *
     * <p>어긋난 축을 field 로 지목한다: 섬 version 이 어긋났으면 {@code expectedVersion}, 섬이
     * 맞는데 충돌이 났으면 남은 축인 {@code expectedCostPolicyVersion} 다(PUT 에는 그 축이 없어
     * 항상 {@code expectedVersion}). 재조회마저 실패하면 지목 근거가 없으므로 current 없이
     * 충돌만 남긴다 — 재시도 판단은 앱이 정본 GET 으로 한다(LLD §3).
     */
    private RuntimeException versionConflict(AccessTokenClaims claims, UUID islandId,
            Long expectedVersion, Long expectedCostPolicyVersion, Deadline deadline) {
        ConstructionOptions current;
        try {
            current = data.fetchConstructionOptions(claims.userId(), islandId, deadline);
        } catch (RuntimeException e) {
            return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, FIELD_VERSION);
        }
        if (current == null) {
            return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, FIELD_VERSION);
        }
        String field = expectedVersion != null && expectedVersion == current.islandVersion()
                && expectedCostPolicyVersion != null ? FIELD_COST_VERSION : FIELD_VERSION;
        return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, field,
                new PublicCurrentState(current.islandVersion(), current));
    }

    /** 공개 오류 한 줄 — 코드와 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(ApiErrorCode code, String field) {
    }
}

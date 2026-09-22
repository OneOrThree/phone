package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.api.PublicCurrentState;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataAppearanceClient;
import com.oneorthree.business.upstream.data.dto.PlaybackPatchResult;
import com.oneorthree.business.upstream.data.dto.PlaybackState;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 공용 음악(방송기) GET·PATCH 의 공개 유스케이스 (GROMO-1779, island-playback LLD §2·§6).
 *
 * <p>주민·방송기·소유·버전·전이 판정은 전부 Data TX 가 한다. Business 는 strict 세션 주체와 tri-state
 * 캐리어만 넘기고, 도메인 실패를 공개 오류 표로 옮기며, 상류 DTO 의 불변식(곡이 있으면 양의 길이 등)이
 * 깨졌으면 임의 값을 채우지 않고 502 로 접는다(LLD §2 fail closed).
 */
@Service
@RequiredArgsConstructor
public class PlaybackUseCase {

    private static final String FIELD_VERSION = "expectedVersion";

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            // 현재 비주민 — GET·PATCH 공통 소속 게이트.
            Map.entry("MEMBER_ONLY", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            // 방송기(gram) 미완공 — GET·PATCH 모두.
            Map.entry("GRAM_LOCKED", new PublicFailure(ApiErrorCode.FACILITY_LOCKED, null)),
            // 등록된 음원이지만 섬 미소유.
            Map.entry("FORBIDDEN", new PublicFailure(ApiErrorCode.FORBIDDEN, "trackId")),
            Map.entry("INVALID_REQUEST", new PublicFailure(ApiErrorCode.INVALID_REQUEST, null)),
            // 미지원 trackId 또는 version 범위 위반.
            Map.entry("OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, null)),
            // 선택 곡 없이 재생 — 서버가 임의 곡을 고르지 않는다.
            Map.entry("STATE_CONFLICT", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "playing")));

    private final DataAppearanceClient data;

    /** GET /islands/{islandId}/playback. */
    public PlaybackState get(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        try {
            return valid(data.fetchIslandPlayback(islandId, claims.userId(), deadline));
        } catch (UpstreamDomainException e) {
            throw mapped(e, null, null, null);
        }
    }

    /**
     * PATCH /islands/{islandId}/playback. VERSION_CONFLICT 는 허용된 409 라 최신 공개 재생 상태를
     * current 로 단다 — 재조회마저 실패하면 current 없이 충돌만 남긴다(외양과 같은 규칙).
     * 공개 응답은 내부 결과의 {@code data} 뿐이다 — events 는 realtime relay 의 몫이다.
     */
    public PlaybackState patch(AccessTokenClaims claims, UUID islandId, List<String> fields,
            Map<String, Object> values, long expectedVersion, UUID key, Deadline deadline) {
        PlaybackPatchResult result;
        try {
            result = data.patchIslandPlayback(islandId, claims.userId(), fields, values, expectedVersion,
                    key, deadline);
        } catch (UpstreamDomainException e) {
            throw mapped(e, claims, islandId, deadline);
        }
        if (result == null) {
            throw new UpstreamContractMismatchException("공용 음악 응답이 계약과 다릅니다");
        }
        return valid(result.data());
    }

    /**
     * 상류 DTO 불변식 — 곡이 없으면 정지·0초·길이 null, 곡이 있으면 양의 유한 길이·0 이상 위치·검증
     * 사용자. 어긋나면 임의 길이를 채우지 않고 502 다.
     */
    private static PlaybackState valid(PlaybackState state) {
        if (state == null || state.version() < 0 || state.positionSeconds() < 0) {
            throw new UpstreamContractMismatchException("공용 음악 응답이 계약과 다릅니다");
        }
        boolean consistent = state.trackId() == null
                ? !state.playing() && state.positionSeconds() == 0 && state.durationSeconds() == null
                : state.durationSeconds() != null && Double.isFinite(state.durationSeconds())
                        && state.durationSeconds() > 0 && state.changedBy() != null;
        if (!consistent) {
            throw new UpstreamContractMismatchException("공용 음악 응답이 계약과 다릅니다");
        }
        return state;
    }

    private RuntimeException mapped(UpstreamDomainException error, AccessTokenClaims claims,
            UUID islandId, Deadline deadline) {
        if (error.getStatus() == 409 && "VERSION_CONFLICT".equals(error.getCode()) && claims != null) {
            return versionConflict(claims, islandId, deadline);
        }
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    /** 409 의 최신 공개 상태 — 같은 세션 주체로 GET 을 한 번 더 읽는다. 내부 행·타 사용자 정보는 싣지 않는다. */
    private RuntimeException versionConflict(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        PlaybackState current;
        try {
            current = valid(data.fetchIslandPlayback(islandId, claims.userId(), deadline));
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

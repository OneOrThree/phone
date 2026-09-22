package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.IslandFocusMembers;
import com.oneorthree.business.upstream.data.dto.IslandRestMembers;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 같이 낚시 초기 스냅샷 2종의 공개 유스케이스 (GROMO-1765, focus-rest-session LLD §2).
 *
 * <p>소속·목록·watermark 는 전부 Data 가 한 스냅샷에서 판정한다 — Business 는 세션 주체만 넘기고 도메인
 * 실패를 공개 오류로 옮긴다. 표에 없는 판정은 그대로 올려 502 로 접힌다({@code IslandConstructionUseCase} 와 같다).
 */
@Service
@RequiredArgsConstructor
public class IslandFocusMembersUseCase {

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.of(
            "USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null),
            // 비주민·없는 섬·종료된 섬 — Data 가 섬 존재를 흘리지 않도록 한 코드로 합쳐 둔 것을 그대로 옮긴다.
            "MEMBER_ONLY", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId"));

    private final DataIslandClient data;

    public IslandFocusMembers focusMembers(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        IslandFocusMembers members = relay(() -> data.fetchFocusMembers(claims.userId(), islandId, deadline));
        if (members == null) {
            throw new UpstreamContractMismatchException("집중 주민 응답이 없습니다");
        }
        return members;
    }

    public IslandRestMembers restMembers(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        IslandRestMembers members = relay(() -> data.fetchRestMembers(claims.userId(), islandId, deadline));
        if (members == null) {
            throw new UpstreamContractMismatchException("휴식 주민 응답이 없습니다");
        }
        return members;
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            // 상태까지 대조한다 — 같은 코드의 상태가 바뀌면 공개 표가 조용히 어긋나는 대신 502 가 된다.
            if (failure == null || failure.code().getStatus().value() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    private record PublicFailure(ApiErrorCode code, String field) {
    }
}

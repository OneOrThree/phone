package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.IslandGuestbooks;
import com.oneorthree.business.upstream.data.dto.IslandNotices;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 섬 방명록 3종의 공개 유스케이스 (GROMO-2262, 섬 외부 계약 §2). 게시판 완공·섬장·하루 1개는 전부 Data 가
 * 판정하고 여기서는 코드만 옮긴다. 상태까지 대조해 Data 가 같은 코드의 상태를 바꾸면 502 로 드러난다.
 */
@Service
@RequiredArgsConstructor
public class IslandGuestbookUseCase {

    /**
     * 상류 (status, code) → 공개 코드·필드. {@code SOCIAL_LOGIN_REQUIRED}·{@code GUESTBOOK_ALREADY_WRITTEN_TODAY}
     * 는 동명 {@link ApiErrorCode} 라 여기 없이 전역 핸들러가 옮긴다.
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.of(
            "USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null),
            "GROUP_NOT_FOUND", new PublicFailure(404, ApiErrorCode.GROUP_NOT_FOUND, "islandId"),
            // 섬장이 아닌 삭제 시도.
            "NOT_OWNER", new PublicFailure(403, ApiErrorCode.FORBIDDEN, null),
            "BOARD_LOCKED", new PublicFailure(403, ApiErrorCode.FACILITY_LOCKED, null),
            // 그 섬에 없는(이미 지워진) 방명록 글.
            "NOT_FOUND", new PublicFailure(404, ApiErrorCode.NOT_FOUND, "entryId"),
            // Data 의 본문 파서 거절 — 공개 경계가 먼저 거르므로 보통 닿지 않는다.
            "INVALID_REQUEST", new PublicFailure(400, ApiErrorCode.INVALID_REQUEST, null));

    private final DataIslandClient data;

    public IslandGuestbooks.Page list(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        return required(relay(() -> data.fetchGuestbook(claims.userId(), islandId, deadline)));
    }

    public IslandGuestbooks.Item write(AccessTokenClaims claims, UUID islandId, String content, Deadline deadline) {
        return required(relay(() -> data.writeGuestbook(claims.userId(), islandId, content, deadline)));
    }

    public IslandNotices.Deleted delete(AccessTokenClaims claims, UUID islandId, UUID entryId, Deadline deadline) {
        IslandNotices.Deleted deleted = relay(() ->
                data.deleteGuestbookEntry(claims.userId(), islandId, entryId, deadline));
        if (deleted == null || !deleted.deleted()) {
            throw new UpstreamContractMismatchException("방명록 삭제 응답이 계약과 다릅니다");
        }
        return deleted;
    }

    private static <T> T required(T value) {
        if (value == null) {
            throw new UpstreamContractMismatchException("방명록 응답이 없습니다");
        }
        return value;
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            if (failure == null || failure.upstreamStatus() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    /** 상류 (status, code) 한 쌍 → 공개 코드와 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }
}

package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.Magazines;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;

/**
 * 고양이 잡지 읽기 (GROMO-2289 발행) — 오늘 호·최근 7호·한 호 펼치기·받기 기록의 공개 유스케이스. 발행·7호 범위·받기
 * 판정은 전부 Data 가 하고, 여기서는 한 호 펼치기의 keyset 경계를 서명 커서로 감싸기만 한다. 상류 오류
 * ({@code MAGAZINE_ISSUE_NOT_FOUND}·{@code USER_NOT_FOUND}·{@code INVALID_REQUEST})는 모두 동명 {@link ApiErrorCode} 라
 * 전역 핸들러가 옮긴다.
 */
@Service
@RequiredArgsConstructor
public class MagazineUseCase {

    private static final String RESOURCE_ISSUE = "magazine/issues";
    private static final String SORT_APPLIED_ASC = "applied-asc";

    private final DataIslandClient data;
    private final SignedCursorCodec codec;

    public Magazines.Today today(AccessTokenClaims claims, Deadline deadline) {
        return required(data.fetchMagazineToday(claims.userId(), deadline));
    }

    public Magazines.Issues issues(AccessTokenClaims claims, Deadline deadline) {
        return required(data.fetchMagazineIssues(claims.userId(), deadline));
    }

    /**
     * 한 호 펼치기 한 페이지. 커서는 사용자·호·정렬·limit 에 묶인다 — 다른 호나 다른 limit 에 내밀면 400
     * {@code INVALID_CURSOR} 다. 첫 페이지는 경계를 싣지 않는다.
     */
    public Magazines.IssueView issue(AccessTokenClaims claims, UUID issueId, String cursor, int limit,
            Deadline deadline) {
        CursorScope scope = new CursorScope(claims.userId(), RESOURCE_ISSUE, Map.of("issueId", issueId.toString()),
                SORT_APPLIED_ASC, limit);
        CursorBoundary boundary = codec.decode(cursor, scope);
        Instant afterAppliedAt = null;
        UUID afterPromotionId = null;
        if (boundary != null) {
            // 서명은 통과했어도 값 자체는 다시 검증한다.
            try {
                afterAppliedAt = Instant.parse(boundary.sortKey());
                afterPromotionId = UUID.fromString(boundary.tieBreaker());
            } catch (DateTimeParseException | IllegalArgumentException e) {
                throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
            }
        }
        Magazines.IssuePage page = required(data.fetchMagazineIssue(claims.userId(), issueId, afterAppliedAt,
                afterPromotionId, limit, deadline));
        if ((page.nextAppliedAt() == null) != (page.nextPromotionId() == null)) {
            throw new UpstreamContractMismatchException("잡지 호 페이지의 다음 경계가 반쪽입니다");
        }
        String next = page.nextAppliedAt() == null ? null : codec.encode(scope,
                new CursorBoundary(page.nextAppliedAt().toString(), page.nextPromotionId().toString()));
        return new Magazines.IssueView(page.issue(), page.editorial(), page.cells(), next);
    }

    public Magazines.Receipt receipt(AccessTokenClaims claims, UUID issueId, String place, Boolean deferred,
            Boolean opened, Deadline deadline) {
        return required(data.recordMagazineReceipt(claims.userId(), issueId, place, deferred, opened, deadline));
    }

    private static <T> T required(T value) {
        if (value == null) {
            throw new UpstreamContractMismatchException("잡지 응답이 없습니다");
        }
        return value;
    }
}

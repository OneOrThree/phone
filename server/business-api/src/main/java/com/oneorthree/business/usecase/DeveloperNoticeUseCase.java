package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.DeveloperNoticeResponses;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.DeveloperNotices;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;

/** 소식 공개 기간은 Data가 판정하며 누락된 응답은 성공으로 합성하지 않는다. */
@Service
@RequiredArgsConstructor
public class DeveloperNoticeUseCase {
    /** 앱이 첫 쪽만 훑어 예약 공지를 고르므로 기본 크기를 줄이지 않는다. */
    public static final int DEFAULT_LIMIT = 100;

    private final DataIslandClient data;
    private final SignedCursorCodec codec;

    /**
     * 최신순 한 쪽. 커서는 사용자·정렬·limit 에 묶인다 — 다른 사용자나 다른 limit 에 내밀면 400
     * {@code INVALID_CURSOR} 다. 커서를 먼저 푸는 것은 위조·만료 커서로 상류를 두드리지 않기 위해서다.
     */
    public DeveloperNoticeResponses.Page list(UUID userId, String cursor, int limit, Deadline deadline) {
        CursorScope scope = new CursorScope(userId, "me/developer-notices", Map.of(), "published-desc", limit);
        CursorBoundary boundary = codec.decode(cursor, scope);
        Instant afterPublishedAt = null;
        UUID afterId = null;
        if (boundary != null) {
            // 서명은 통과했어도 값 자체는 다시 검증한다 — 첫 쪽으로 접지 않는다.
            try {
                afterPublishedAt = Instant.parse(boundary.sortKey());
                afterId = UUID.fromString(boundary.tieBreaker());
            } catch (DateTimeParseException | IllegalArgumentException e) {
                throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
            }
        }
        DeveloperNotices.Page page = required(data.fetchDeveloperNotices(userId, afterPublishedAt, afterId, limit,
                deadline));
        boolean hasMore = Boolean.TRUE.equals(page.hasMore());
        if (page.items().size() > limit || (hasMore && page.items().size() != limit)) {
            throw new UpstreamContractMismatchException("개발자 소식 페이지 크기가 계약과 다릅니다");
        }
        String next = null;
        if (hasMore) {
            DeveloperNotices.Notice last = page.items().get(page.items().size() - 1);
            next = codec.encode(scope, new CursorBoundary(last.publishedAt().toString(),
                    last.publicationId().toString()));
        }
        return DeveloperNoticeResponses.Page.from(page, next);
    }

    public DeveloperNotices.Notice get(UUID userId, UUID publicationId, Deadline deadline) {
        return required(data.fetchDeveloperNotice(userId, publicationId, deadline));
    }

    public DeveloperNotices.AppRequirement appRequirement(String platform, Deadline deadline) {
        return required(data.fetchAppRequirement(platform, deadline));
    }

    private static <T> T required(T value) {
        if (value == null) {
            throw new UpstreamContractMismatchException("개발자 소식 응답이 없습니다");
        }
        return value;
    }
}

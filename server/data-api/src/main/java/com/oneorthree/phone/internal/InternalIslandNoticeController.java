package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.dto.NoticeCommentRequest;
import com.oneorthree.phone.internal.dto.NoticeCreateRequest;
import com.oneorthree.phone.internal.dto.NoticePatchRequest;
import com.oneorthree.phone.internal.service.IslandNoticeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 게시판의 Data 내부 표면 (GROMO-1771) — 공개 {@code /islands/{islandId}/notices…} 6종의 상류다. 호출자는
 * Business 하나이고 caller 별 exact 허용목록({@code application-satellites.yml})이 여섯 경로를 연다. 주체는
 * {@code InternalAuthFilter} 가 검증한 {@code X-User-Id} 뿐이다 — 본문에 사용자 id 를 받지 않는다.
 *
 * <p>커서는 여기 없다. Business 가 서명 커서를 풀어 불변 정렬 키 두 값({@code …AfterCreatedAt}·{@code …AfterId})
 * 으로 넘기고, 응답의 {@code hasMore} 와 마지막 행으로 다음 커서를 만든다. 쓰기 네 경로는 모두
 * {@code Idempotency-Key} 가 필수다(api-platform LLD §2).
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandNoticeController {

    private final IslandNoticeService notices;

    @GetMapping("/internal/islands/{islandId}/notices")
    public IslandNoticeViews.Page list(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestParam(required = false) Instant afterCreatedAt, @RequestParam(required = false) UUID afterId,
            @RequestParam int limit) {
        return notices.list(islandId, userId, afterCreatedAt, afterId, limit);
    }

    @GetMapping("/internal/islands/{islandId}/notices/{noticeId}")
    public IslandNoticeViews.Detail detail(@PathVariable UUID islandId, @PathVariable UUID noticeId,
            @RequestHeader("X-User-Id") UUID userId,
            @RequestParam(required = false) Instant commentsAfterCreatedAt,
            @RequestParam(required = false) UUID commentsAfterId, @RequestParam int commentsLimit) {
        return notices.detail(islandId, noticeId, userId, commentsAfterCreatedAt, commentsAfterId, commentsLimit);
    }

    @PostMapping("/internal/islands/{islandId}/notices")
    public IslandNoticeViews.Notice create(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestHeader("Idempotency-Key") UUID key, @Valid @RequestBody NoticeCreateRequest body) {
        return notices.create(islandId, userId, body.title(), body.body(), key);
    }

    @PatchMapping("/internal/islands/{islandId}/notices/{noticeId}")
    public IslandNoticeViews.Notice update(@PathVariable UUID islandId, @PathVariable UUID noticeId,
            @RequestHeader("X-User-Id") UUID userId, @RequestHeader("Idempotency-Key") UUID key,
            @Valid @RequestBody NoticePatchRequest body) {
        return notices.update(islandId, noticeId, userId, body.title(), body.body(), key);
    }

    @DeleteMapping("/internal/islands/{islandId}/notices/{noticeId}")
    public IslandNoticeViews.Deleted delete(@PathVariable UUID islandId, @PathVariable UUID noticeId,
            @RequestHeader("X-User-Id") UUID userId, @RequestHeader("Idempotency-Key") UUID key) {
        return notices.delete(islandId, noticeId, userId, key);
    }

    @PostMapping("/internal/islands/{islandId}/notices/{noticeId}/comments")
    public IslandNoticeViews.CommentCreated comment(@PathVariable UUID islandId, @PathVariable UUID noticeId,
            @RequestHeader("X-User-Id") UUID userId, @RequestHeader("Idempotency-Key") UUID key,
            @Valid @RequestBody NoticeCommentRequest body) {
        return notices.comment(islandId, noticeId, userId, body.text(), key);
    }
}

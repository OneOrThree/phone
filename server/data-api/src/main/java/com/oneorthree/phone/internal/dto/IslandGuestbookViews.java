package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 방명록 응답 (GROMO-2262, 섬 외부 계약 §2). 삭제 응답은 공지와 같은
 * {@link IslandNoticeViews.Deleted}({@code {deleted:true}}) 를 쓴다.
 *
 * @param boardBuilt 게시판이 지어졌는가 — false 면 {@code items} 는 항상 비어 있다
 */
public final class IslandGuestbookViews {

    private IslandGuestbookViews() {
    }

    public record Page(boolean boardBuilt, List<Item> items) {
    }

    /** @param mine 호출자가 쓴 글인가 */
    public record Item(UUID id, UUID authorId, String authorName, String content, Instant createdAt,
                       boolean mine) {
    }
}

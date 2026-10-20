package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 방명록 응답 (GROMO-2262, 섬 외부 계약 §2). 삭제 응답은 공지와 같은
 * {@link IslandNoticeViews.Deleted}({@code {deleted:true}}) 를 쓴다.
 *
 * @param boardBuilt 게시판이 <b>실제로 완공</b>됐는가 — 시설 게이트 플래그와 무관하며 섬 상세의 {@code buildings} 와
 *     같은 근거다. 게이트가 켜진 환경에서 false 면 {@code items} 는 비어 있다
 */
public final class IslandGuestbookViews {

    private IslandGuestbookViews() {
    }

    public record Page(boolean boardBuilt, List<Item> items, boolean hasMore) {
    }

    /** @param mine 호출자가 쓴 글인가 */
    public record Item(UUID id, UUID authorId, String authorName, String content, Instant createdAt,
                       boolean mine) {
    }
}

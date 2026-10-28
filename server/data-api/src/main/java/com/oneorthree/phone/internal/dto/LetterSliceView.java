package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * 편지함 커서 페이지 (GROMO-1933) — {@code FocusSessionSliceResponse} 와 같은 모양이다.
 *
 * <p>빈 페이지도 이 봉투 <b>한 겹</b>으로 내려간다. 내부 표면이 빈 본문을 주면 Business 의
 * {@code InternalHttpClient} 가 빈 2xx 를 계약 불일치(502)로 올린다.
 *
 * @param content    현재 페이지(최신순). 빈 목록은 {@code []} 다
 * @param size       요청 페이지 크기(기본 20)
 * @param hasNext    다음 페이지 존재 여부 — count 쿼리 없이 {@code size+1} 조회로 판정한다
 * @param nextCursor 다음 조회에 넘길 커서(이 페이지 마지막 항목 id). {@code hasNext=false} 면 null
 */
public record LetterSliceView(
        List<LetterItemView> content,
        int size,
        boolean hasNext,
        UUID nextCursor) {
}

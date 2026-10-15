package com.oneorthree.phone.focus.dto;

import java.util.List;
import java.util.UUID;

/**
 * 집중 세션 커서(keyset) 페이지네이션 응답.
 * 정렬은 UUID v7 id 기준(생성 시간순) 내림차순.
 *
 * @param content    현재 페이지 세션 목록(최신순)
 * @param size       요청 페이지 크기
 * @param hasNext    다음 페이지 존재 여부
 * @param nextCursor 다음 조회에 넘길 커서(마지막 항목 id). hasNext=false 면 null
 */
public record FocusSessionSliceResponse(
        List<FocusSessionResponse> content,
        int size,
        boolean hasNext,
        UUID nextCursor
) {
}

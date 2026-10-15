package com.oneorthree.phone.group.dto;

import java.util.List;
import java.util.UUID;

/**
 * 내기 히스토리 커서(keyset) 페이지네이션 응답(GROMO-1207) —
 * {@code FocusSessionSliceResponse}(content, size, hasNext, nextCursor) 봉투 선례를 그대로 따른다.
 * 정렬은 {@code bet_date} 내림차순(최신 정산 먼저).
 *
 * @param content    현재 페이지 내기 목록(최신순)
 * @param size       요청 페이지 크기
 * @param hasNext    다음 페이지 존재 여부
 * @param nextCursor 다음 조회에 넘길 커서(마지막 항목 betId). hasNext=false 면 null
 */
public record GroupBetHistorySliceResponse(
        List<GroupBetHistoryItemResponse> content,
        int size,
        boolean hasNext,
        UUID nextCursor
) {
}

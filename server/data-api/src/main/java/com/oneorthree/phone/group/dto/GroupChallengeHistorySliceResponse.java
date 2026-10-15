package com.oneorthree.phone.group.dto;

import java.util.List;
import java.util.UUID;

/**
 * 그룹 챌린지 내역 커서(keyset) 페이지네이션 응답(GROMO-1271) —
 * {@link GroupBetHistorySliceResponse} 봉투 선례를 그대로 따른다. 정렬은
 * {@code (session_date, id)} 내림차순 — 그룹 전체 조회라 같은 날짜에 회차가 여럿이라 날짜 단독
 * 커서로는 페이지 경계가 샌다.
 *
 * @param content    현재 페이지 회차 목록(최신순)
 * @param size       요청 페이지 크기
 * @param hasNext    다음 페이지 존재 여부
 * @param nextCursor 다음 조회에 넘길 커서(마지막 항목 sessionId). hasNext=false 면 null
 */
public record GroupChallengeHistorySliceResponse(
        List<GroupChallengeHistoryItemResponse> content,
        int size,
        boolean hasNext,
        UUID nextCursor
) {
}

package com.oneorthree.phone.group.dto;

import java.util.List;

/**
 * {@code GET /me/bet-sessions?status=OPEN} 응답 봉투(GROMO-1415) — 최상위를 객체로 감싸
 * 이후 필드 추가가 additive 가 되게 한다(LLD §2.1 {@code { sessions: [...] }}).
 *
 * @param sessions 내 OPEN 회차 목록(회차일 오름차순)
 */
public record MyBetSessionsResponse(List<MyBetSessionResponse> sessions) {
}

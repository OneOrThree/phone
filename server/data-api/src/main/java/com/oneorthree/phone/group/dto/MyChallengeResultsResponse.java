package com.oneorthree.phone.group.dto;

import java.util.List;

/**
 * {@code GET /me/challenge-results} 응답 봉투(GROMO-1415, N53) — LLD §2.1
 * {@code { results: [...] }}. 항목 안의 {@code results}(인별 결과)와 이름이 겹치지만 계약이
 * 그 모양이다.
 *
 * @param results 내 정산 완료 회차 목록(회차일 내림차순, 최근 30일·최대 10건 — §D3)
 */
public record MyChallengeResultsResponse(List<MyChallengeResultResponse> results) {
}

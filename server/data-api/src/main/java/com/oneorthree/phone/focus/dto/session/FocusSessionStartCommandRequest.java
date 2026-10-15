package com.oneorthree.phone.focus.dto.session;

import java.util.UUID;

/**
 * {@code POST /focus-sessions} 요청 본문 (GROMO-1764, LLD §2 start).
 *
 * @param islandId      세션을 시작할 섬 — 반드시 사용자의 <b>현재</b> 소속 섬이어야 한다(FR-P03)
 * @param subject       집중 주제(자유 문자열)
 * @param targetMinutes 목표 시간(분) — <b>선택</b>(GROMO-1990: 보상이 시간에만 걸려 목표가 필수가 아니다).
 *                      값이 있으면 0 이하는 거절한다 — 상한/카탈로그는 FR-D06 미결이라 두지 않는다
 */
public record FocusSessionStartCommandRequest(UUID islandId, String subject, Integer targetMinutes) {
}

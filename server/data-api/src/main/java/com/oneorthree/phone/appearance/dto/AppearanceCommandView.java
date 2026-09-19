package com.oneorthree.phone.appearance.dto;

import java.util.List;
import java.util.Map;

/**
 * PATCH 내부 응답 — {@code data} 는 공개 PATCH 응답과 동일한 객체이고 {@code events} 는
 * 같은 TX 에 outbox 에 적은 전송용 봉투 목록이다. 멱등 재생은 receipt 의 원본 JSON 을 그대로
 * 돌려주므로 data·events 모두 재발행 없이 복구된다(건설 도메인과 같은 저장 형식).
 *
 * @param <T> PATCH 종류별 data 타입 — 개인은 {@link PersonalAppearanceView},
 *     섬은 {@link IslandAppearanceView}
 */
public record AppearanceCommandView<T>(T data, List<Map<String, Object>> events) {
}

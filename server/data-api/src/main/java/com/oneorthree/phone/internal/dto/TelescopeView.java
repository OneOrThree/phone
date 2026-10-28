package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;

/**
 * {@code GET /internal/users/{userId}/telescope} 응답 (GROMO-2265, 섬 외부 계약 §5).
 *
 * @param bucketStart        이 목록의 1시간 버킷 시작({@code now} 를 정시로 자른 값, UTC = KST 정각)
 * @param nextRefreshMinutes 다음 목록까지 남은 분 — {@code ceil((bucketStart + 1h − now) / 1분)}, 1~60
 * @param items              무인도 후보가 뽑히면 맨 앞, 이후 {@code joined} → {@code nearby} → {@code pinned} → {@code random} 순
 */
public record TelescopeView(Instant bucketStart, int nextRefreshMinutes, List<TelescopeItemView> items) {
}

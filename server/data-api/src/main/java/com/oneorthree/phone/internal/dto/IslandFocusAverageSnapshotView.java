package com.oneorthree.phone.internal.dto;

import java.time.LocalDate;

/**
 * 섬별 7일 평균 스냅샷 수동 실행의 응답 (GROMO-2280).
 *
 * @param snapshotDate 적은 날짜(KST)
 * @param inserted     새로 적힌 행 수 — 같은 날 다시 부르면 0 이다
 */
public record IslandFocusAverageSnapshotView(LocalDate snapshotDate, int inserted) {
}

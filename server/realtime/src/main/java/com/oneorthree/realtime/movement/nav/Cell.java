package com.oneorthree.realtime.movement.nav;

/** 통행 격자의 셀 좌표(0 기반). 셀 한 칸 = 월드 1 unit, index 는 행 우선 {@code cy * cols + cx}. */
public record Cell(int cx, int cy) {
}

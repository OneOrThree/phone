package com.oneorthree.realtime.movement.nav;

/** 월드 좌표 {@code [0,100]²} 실수. 원점 좌상단, +x 오른쪽, +y 아래(앱 {@code worldCoords.ts} 의 WorldPoint). */
public record WorldPoint(double x, double y) {
}

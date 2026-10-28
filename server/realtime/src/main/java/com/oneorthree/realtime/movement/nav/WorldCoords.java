package com.oneorthree.realtime.movement.nav;

import java.util.Optional;

/**
 * 좌표 변환 — 앱 {@code app/app-dev/src/utils/worldCoords.ts} 와 <b>같은 식, 같은 연산 순서</b>
 * (HLD §2: {@code worldX = imageX / (imageWidth / 100)}, 셀 {@code min(99, floor)}).
 *
 * <p>double 연산 순서까지 맞춰야 앱과 마지막 비트가 같다 — 식을 «수학적으로 같은» 다른 모양으로 바꾸지 않는다.
 * 테스트는 {@code worldCoords.test.ts} 케이스를 그대로 옮긴 {@code WorldCoordsTest}.
 */
public final class WorldCoords {

    /** 월드 범위 {@code [0,100]²}, 통행 셀도 100×100. */
    public static final int WORLD_SIZE = 100;

    /** 이미지 px 좌표(현재 그림 1536×1024). */
    public record ImagePoint(double x, double y) {
    }

    /** 와이어 좌표(월드 ×100 정수) — 바이너리 프로토콜(2단계) 전용이다. 1단계 JSON 은 월드 실수를 쓴다. */
    public record Wire(int x, int y) {
    }

    private WorldCoords() {
    }

    /** 화면 → 이미지 px. 결과가 유한하지 않으면(scale 0·NaN) 빈 값 — 앱과 같은 계약. */
    public static Optional<ImagePoint> screenToImage(double x, double y, double offsetX, double offsetY,
            double scale) {
        double ix = (x - offsetX) / scale;
        double iy = (y - offsetY) / scale;
        return Double.isFinite(ix) && Double.isFinite(iy) ? Optional.of(new ImagePoint(ix, iy)) : Optional.empty();
    }

    public static WorldPoint imageToWorld(double x, double y, double imageWidth, double imageHeight) {
        return new WorldPoint(x / (imageWidth / WORLD_SIZE), y / (imageHeight / WORLD_SIZE));
    }

    public static ImagePoint worldToImage(double x, double y, double imageWidth, double imageHeight) {
        return new ImagePoint(x * (imageWidth / WORLD_SIZE), y * (imageHeight / WORLD_SIZE));
    }

    /** nav 인덱싱용 — 범위 밖은 경계 셀로 clamp(정확히 100 은 99), 비유한값은 0. 범위 검사는 {@link #isInsideWorld}. */
    public static Cell worldToCell(double x, double y) {
        return new Cell(cell(x), cell(y));
    }

    public static WorldPoint cellCenter(Cell c) {
        return new WorldPoint(c.cx() + 0.5, c.cy() + 0.5);
    }

    /** 유한값이고 {@code [0,100]} 안이면 true(경계 포함). 범위 밖 입력은 서버가 거부한다. */
    public static boolean isInsideWorld(double x, double y) {
        return inRange(x) && inRange(y);
    }

    /** 범위 밖·비유한값은 clamp 하지 않고 빈 값. */
    public static Optional<Wire> worldToWire(double x, double y) {
        return isInsideWorld(x, y)
                ? Optional.of(new Wire((int) Math.round(x * 100), (int) Math.round(y * 100)))
                : Optional.empty();
    }

    public static WorldPoint wireToWorld(int x, int y) {
        return new WorldPoint(x / 100.0, y / 100.0);
    }

    private static int cell(double v) {
        return (int) Math.max(0, Math.min(WORLD_SIZE - 1, Math.floor(Double.isFinite(v) ? v : 0)));
    }

    private static boolean inRange(double v) {
        return Double.isFinite(v) && v >= 0 && v <= WORLD_SIZE;
    }
}

package com.oneorthree.realtime.movement.nav;

import com.oneorthree.realtime.movement.nav.WorldCoords.ImagePoint;
import com.oneorthree.realtime.movement.nav.WorldCoords.Wire;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.byLessThan;
import static org.assertj.core.api.Assertions.within;

/**
 * 앱 {@code app/app-dev/src/utils/worldCoords.test.ts} 8케이스를 그대로 옮겼다(티켓 2245 완료 조건 3) — 이름도 같다.
 * 앱 쪽 케이스가 바뀌면 여기도 같이 바꾼다.
 */
class WorldCoordsTest {

    private static final double W = 1536;
    private static final double H = 1024;

    @Test
    @DisplayName("회관 앵커 (1095,321) → world → cell → wire")
    void hallAnchor() {
        WorldPoint w = WorldCoords.imageToWorld(1095, 321, W, H);

        assertThat(w.x()).isCloseTo(71.29, byLessThan(0.005));
        assertThat(w.y()).isCloseTo(31.35, byLessThan(0.005));
        assertThat(WorldCoords.worldToCell(w.x(), w.y())).isEqualTo(new Cell(71, 31));
        assertThat(WorldCoords.worldToWire(71.29, 31.35)).contains(new Wire(7129, 3135));
    }

    @Test
    @DisplayName("screen → image 는 offset 을 빼고 scale 로 나눈다")
    void screenToImage() {
        assertThat(WorldCoords.screenToImage(120, 70, 20, 10, 0.5)).contains(new ImagePoint(200, 120));
    }

    @Test
    @DisplayName("world → wire → world 왕복 오차는 축당 0.005 이하")
    void wireRoundTrip() {
        for (double v : new double[] {0, 0.004, 12.3456, 50.005, 99.999, 100}) {
            Wire wire = WorldCoords.worldToWire(v, v).orElseThrow();
            WorldPoint back = WorldCoords.wireToWorld(wire.x(), wire.y());
            assertThat(back.x()).as("x %s", v).isCloseTo(v, within(0.005 + 1e-9));
            assertThat(back.y()).as("y %s", v).isCloseTo(v, within(0.005 + 1e-9));
        }
    }

    @Test
    @DisplayName("world ↔ image 왕복")
    void imageRoundTrip() {
        ImagePoint img = WorldCoords.worldToImage(33.3, 66.6, W, H);
        WorldPoint w = WorldCoords.imageToWorld(img.x(), img.y(), W, H);

        assertThat(w.x()).isCloseTo(33.3, byLessThan(0.5e-9));
        assertThat(w.y()).isCloseTo(66.6, byLessThan(0.5e-9));
    }

    @Test
    @DisplayName("셀 경계: min(99, floor), 음수는 0")
    void cellBoundary() {
        assertThat(WorldCoords.worldToCell(0, 0)).isEqualTo(new Cell(0, 0));
        assertThat(WorldCoords.worldToCell(99.99, 100)).isEqualTo(new Cell(99, 99));
        assertThat(WorldCoords.worldToCell(-3.2, -0.01)).isEqualTo(new Cell(0, 0));
        assertThat(WorldCoords.cellCenter(new Cell(71, 31))).isEqualTo(new WorldPoint(71.5, 31.5));
    }

    @Test
    @DisplayName("범위 밖·비유한값은 worldToWire 가 null, 경계(0·100)는 통과")
    void wireRange() {
        assertThat(WorldCoords.worldToWire(-0.01, 5)).isEmpty();
        assertThat(WorldCoords.worldToWire(5, 100.01)).isEmpty();
        assertThat(WorldCoords.worldToWire(Double.NaN, 5)).isEmpty();
        assertThat(WorldCoords.worldToWire(100, 0)).contains(new Wire(10000, 0));
        assertThat(WorldCoords.worldToCell(100, 100)).isEqualTo(new Cell(99, 99));
    }

    @Test
    @DisplayName("isInsideWorld 경계")
    void insideWorld() {
        assertThat(WorldCoords.isInsideWorld(0, 100)).isTrue();
        assertThat(WorldCoords.isInsideWorld(-0.01, 50)).isFalse();
        assertThat(WorldCoords.isInsideWorld(50, 100.01)).isFalse();
        assertThat(WorldCoords.isInsideWorld(Double.POSITIVE_INFINITY, 1)).isFalse();
    }

    @Test
    @DisplayName("NaN·±Infinity 는 throw 없이 처리한다")
    void nonFinite() {
        assertThat(WorldCoords.worldToCell(Double.NaN, Double.POSITIVE_INFINITY)).isEqualTo(new Cell(0, 0));
        assertThat(WorldCoords.worldToWire(Double.NaN, Double.NEGATIVE_INFINITY)).isEmpty();
        assertThat(WorldCoords.screenToImage(5, 5, 0, 0, 0)).isEmpty();
        assertThat(WorldCoords.screenToImage(Double.NaN, 5, 0, 0, 1)).isEmpty();
    }
}

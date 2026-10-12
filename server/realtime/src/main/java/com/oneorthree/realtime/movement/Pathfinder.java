package com.oneorthree.realtime.movement;

import com.oneorthree.realtime.movement.nav.NavGrid;
import com.oneorthree.realtime.movement.nav.Pathfinder.PathResult;
import com.oneorthree.realtime.movement.nav.WorldPoint;

import java.util.Optional;

/**
 * {@code nav.Pathfinder} 의 정적 A* 를 얇게 감싼 인스턴스 시임(seam).
 *
 * <p>{@link RoomRuntime} 은 {@code nav.Pathfinder} 의 정적 메서드를 직접 부르지 않고 이 타입을
 * 생성자로 주입받아 쓴다 — 나중에 경로 탐색 구현을 바꿔 끼우거나 테스트 대체물을 꽂을 자리를
 * 남긴다(지금은 구현이 하나, {@code nav.Pathfinder} 뿐이다). {@code final} 이 아닌 것도 그래서다 —
 * 2245 가 스폰 셀 통행을 로더에서 강제한 뒤로는 {@code nav.Pathfinder.resolveTarget} 이 항상 출발
 * 영역 안 최근접 셀로 보정해, 합성 격자만으로는 "경로 없음"을 더는 재현할 수 없다({@code
 * RoomRuntimeTest.UnreachablePathfinder} 가 이 자리를 상속해 직접 흉내 낸다).
 */
public class Pathfinder {

    /** from → to 경로. 보정 실패·도달 불가면 빈 값 — {@code nav.Pathfinder.find} 와 같다. */
    public Optional<PathResult> find(NavGrid grid, WorldPoint from, WorldPoint to) {
        return com.oneorthree.realtime.movement.nav.Pathfinder.find(grid, from, to);
    }
}

package com.oneorthree.realtime.movement.nav;

import java.util.Arrays;
import java.util.Comparator;
import java.util.Optional;
import java.util.PriorityQueue;

/**
 * 8방향 A* — 앱 {@code app/app-dev/src/utils/nav-path.ts} 의 {@code resolveTarget}·{@code navPathDetailed} 와
 * <b>같은 정수 연산을 같은 순서로</b> 한다(HLD §3). 공통 fixture
 * {@code docs/prd/fishcat/island-movement/fixtures/paths.json} 을 {@code PathfinderTest} 와 앱 테스트가 같이 통과한다.
 *
 * <pre>
 * edge(p→q) = ceilDiv(step × cost[q], 10)        step = 직교 10⁶ · 대각 1,414,214(리터럴), cost = ×10 정수
 * h(p)      = floorDiv(floor(√(dx²+dy²) × 10⁶) × minCost, 10)   sqrt·곱·floor 만 double(IEEE 라 JS 와 같다)
 * 우선순위 (f, h, index) 오름차순 · 낡은 항목 skip f > best[p] + h(p) · 개선은 strict c &lt; best[q]
 * </pre>
 *
 * <p>{@code Math.hypot} 는 쓰지 않는다 — JVM 과 V8 의 결과가 마지막 비트에서 다를 수 있다. 최근접 셀도 제곱 거리로 비교한다.
 */
public final class Pathfinder {

    static final long SCALE = 1_000_000L;
    static final long STEP_STRAIGHT = SCALE;
    /** ceil(√2 × 10⁶). sqrt 결과에 기대지 않도록 리터럴로 둔다. */
    static final long STEP_DIAG = 1_414_214L;

    /** 출발 셀과 (보정된) 목적지 셀 index. */
    public record Target(int startIndex, int goalIndex) {
    }

    /** A* 결과. cells 는 출발 셀을 뺀 index 열(같은 셀이면 비어 있다), cost 는 고정소수점 정수. */
    public record PathResult(int startIndex, int goalIndex, long cost, int[] cells) {
    }

    // 같은 셀은 더 작은 f 로만 다시 들어가 (f, h, index) 가 항목마다 유일하다 — 앱의 이진 힙과 꺼내는 순서가 같다.
    private record Node(long f, long h, int index) {
    }

    private static final Comparator<Node> ORDER = Comparator.comparingLong(Node::f)
            .thenComparingLong(Node::h)
            .thenComparingInt(Node::index);

    private Pathfinder() {
    }

    /**
     * 출발 셀이 비통행이면 전체 통행 셀 중 최근접에서 출발하고, 목적지가 비통행이거나 출발 영역 밖이면 출발 영역 안
     * 최근접 셀로 보정한다(HLD §3 ③). 목적지가 범위 밖(비유한값 포함)이거나 출발할 셀이 없으면 빈 값.
     */
    public static Optional<Target> resolveTarget(NavGrid grid, WorldPoint from, WorldPoint to) {
        // 좌표 계약(HLD §2): 서버는 범위 밖 입력을 거부한다 — 앱은 탭이 이미지 안이라 실제로는 못 만들지만 계약을 맞춘다.
        if (!WorldCoords.isInsideWorld(to.x(), to.y())) {
            return Optional.empty();
        }
        int s = startCell(grid, from);
        if (s < 0) {
            return Optional.empty();
        }
        int t = grid.index(WorldCoords.worldToCell(to.x(), to.y()));
        int e = grid.walkable(t) && grid.region(t) == grid.region(s)
                ? t
                : nearestCell(grid, to.x(), to.y(), grid.region(s));
        return e < 0 ? Optional.empty() : Optional.of(new Target(s, e));
    }

    /** from → to 경로. 보정 실패·도달 불가면 빈 값, 같은 셀이면 cells 가 빈 결과. 경로 단순화·길이 상한 없음. */
    public static Optional<PathResult> find(NavGrid grid, WorldPoint from, WorldPoint to) {
        Optional<Target> target = resolveTarget(grid, from, to);
        if (target.isEmpty()) {
            return Optional.empty();
        }
        int s = target.get().startIndex();
        int e = target.get().goalIndex();
        if (s == e) {
            return Optional.of(new PathResult(s, e, 0, new int[0]));
        }
        int n = grid.size();
        int gx = e % grid.cols();
        int gy = e / grid.cols();
        long[] best = new long[n];
        Arrays.fill(best, Long.MAX_VALUE);
        int[] parent = new int[n];
        Arrays.fill(parent, -1);
        PriorityQueue<Node> open = new PriorityQueue<>(ORDER);
        best[s] = 0;
        long hs = heuristic(grid, s, gx, gy);
        open.add(new Node(hs, hs, s));
        while (!open.isEmpty()) {
            Node top = open.poll();
            int p = top.index();
            if (top.f() > best[p] + top.h()) {
                continue; // 낡은 항목
            }
            if (p == e) {
                break;
            }
            for (int[] d : NavGrid.DIRS) {
                int q = grid.neighbor(p, d[0], d[1]);
                if (q < 0) {
                    continue;
                }
                long step = d[0] != 0 && d[1] != 0 ? STEP_DIAG : STEP_STRAIGHT;
                long c = best[p] + ceilDiv10(step * grid.costTenths(q));
                if (c < best[q]) {
                    best[q] = c;
                    parent[q] = p;
                    long hq = heuristic(grid, q, gx, gy);
                    open.add(new Node(c + hq, hq, q));
                }
            }
        }
        if (parent[e] < 0) {
            return Optional.empty();
        }
        int len = 0;
        for (int p = e; p != s; p = parent[p]) {
            len++;
        }
        int[] cells = new int[len];
        int i = len;
        for (int p = e; p != s; p = parent[p]) {
            cells[--i] = p;
        }
        return Optional.of(new PathResult(s, e, best[e], cells));
    }

    private static int startCell(NavGrid grid, WorldPoint from) {
        int i = grid.index(WorldCoords.worldToCell(from.x(), from.y()));
        return grid.walkable(i) ? i : nearestCell(grid, from.x(), from.y(), -1);
    }

    // region 이 -1 이면 전체 통행 셀. 셀 중심 (cx+0.5, cy+0.5) 까지 제곱 거리 strict < — 동률은 index 작은 쪽.
    private static int nearestCell(NavGrid grid, double px, double py, int region) {
        int best = -1;
        double bestD = Double.POSITIVE_INFINITY;
        for (int i = 0; i < grid.size(); i++) {
            if (!grid.walkable(i) || (region >= 0 && grid.region(i) != region)) {
                continue;
            }
            double dx = px - (i % grid.cols() + 0.5);
            double dy = py - (i / grid.cols() + 0.5);
            double d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best;
    }

    private static long heuristic(NavGrid grid, int p, int gx, int gy) {
        int dx = p % grid.cols() - gx;
        int dy = p / grid.cols() - gy;
        long scaled = (long) Math.floor(Math.sqrt(dx * dx + dy * dy) * SCALE);
        return scaled * grid.minCostTenths() / 10;
    }

    // 음 아닌 정수의 a/10 올림.
    private static long ceilDiv10(long a) {
        return (a + 9) / 10;
    }
}

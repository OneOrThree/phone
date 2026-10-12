package com.oneorthree.realtime.movement.nav;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 통행 격자 — 앱 {@code nav-path.ts} 의 {@code loadNav} 결과와 같은 내용이다(셀 index 행 우선 {@code cy * cols + cx}).
 *
 * <p>{@link NavJsonLoader} 만 만든다. 배열은 밖으로 내주지 않고 칸 단위로만 읽게 해 불변으로 둔다 —
 * 여러 방(섬)이 같은 격자 하나를 공유해도 된다.
 *
 * <p>이웃 규칙({@link #neighbor})은 연결 영역 라벨링과 A* 가 같이 쓴다. 앱과 한 글자라도 다르면 영역 보정과 경로가
 * 갈라진다: 대각은 양옆 직교 셀이 둘 다 통행일 때만, 막힌 간선은 직교 이동에만 적용한다.
 */
public final class NavGrid {

    /**
     * 이웃 순서 (dx, dy) — 앱 DIRS 와 같게 둔다(계약 §1). 결과는 이 순서에 기대지 않는다:
     * A* 가 꺼내는 순서는 항목마다 유일한 (f, h, index) 가 정하고, 영역 라벨은 같은지만 비교한다.
     */
    static final int[][] DIRS = {{-1, -1}, {0, -1}, {1, -1}, {-1, 0}, {1, 0}, {-1, 1}, {0, 1}, {1, 1}};

    private final int cols;
    private final int rows;
    private final boolean[] walkable;
    private final int[] costTenths;
    private final Set<Long> blockedEdges;
    private final int minCostTenths;
    private final int[] region;
    private final Map<String, Cell> entrances;
    private final Map<String, Cell> spawns;

    /** 배열은 로더가 새로 만든 것을 넘겨받는다(복사하지 않는다). */
    NavGrid(int cols, int rows, boolean[] walkable, int[] costTenths, Set<Long> blockedEdges,
            Map<String, Cell> entrances, Map<String, Cell> spawns) {
        this.cols = cols;
        this.rows = rows;
        this.walkable = walkable;
        this.costTenths = costTenths;
        this.blockedEdges = Set.copyOf(blockedEdges);
        this.entrances = Collections.unmodifiableMap(new LinkedHashMap<>(entrances));
        this.spawns = Collections.unmodifiableMap(new LinkedHashMap<>(spawns));
        int min = Integer.MAX_VALUE;
        for (int i = 0; i < walkable.length; i++) {
            if (walkable[i]) {
                min = Math.min(min, costTenths[i]);
            }
        }
        // 통행 셀이 없으면 10 — 앱 loadNav 와 같다.
        this.minCostTenths = min == Integer.MAX_VALUE ? 10 : min;
        this.region = labelRegions();
    }

    public int cols() {
        return cols;
    }

    public int rows() {
        return rows;
    }

    public int size() {
        return walkable.length;
    }

    /** 격자 밖 index 는 비통행 — 앱에서 범위 밖 배열 접근이 undefined(거짓)인 것과 같다. */
    public boolean walkable(int index) {
        return index >= 0 && index < walkable.length && walkable[index];
    }

    /** 셀 비용 ×10 정수(길 8, 잔디 27). */
    public int costTenths(int index) {
        return costTenths[index];
    }

    /** 통행 셀 최소 비용 ×10 — 휴리스틱 계수. */
    public int minCostTenths() {
        return minCostTenths;
    }

    /** 연결 영역 라벨(비통행 -1). 같은 값끼리만 서로 걸어갈 수 있다. */
    public int region(int index) {
        return region[index];
    }

    public int index(Cell cell) {
        return cell.cy() * cols + cell.cx();
    }

    public Cell cellOf(int index) {
        return new Cell(index % cols, index / cols);
    }

    /** 건물 입구 셀(nav.json {@code entrances}). 합성 격자에는 없다. */
    public Map<String, Cell> entrances() {
        return entrances;
    }

    /** 스폰 셀(nav.json {@code spawns}). */
    public Map<String, Cell> spawns() {
        return spawns;
    }

    /** p 에서 (dx, dy) 로 한 칸 간 셀 index, 못 가면 -1. */
    int neighbor(int p, int dx, int dy) {
        int x = p % cols + dx;
        int y = p / cols + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) {
            return -1;
        }
        int q = y * cols + x;
        if (!walkable[q]) {
            return -1;
        }
        if ((dx == 0 || dy == 0) && blockedEdges.contains(edgeKey(p, q, walkable.length))) {
            return -1;
        }
        if (dx != 0 && dy != 0 && (!walkable[(y - dy) * cols + x] || !walkable[y * cols + x - dx])) {
            return -1;
        }
        return q;
    }

    /** 무방향 간선 키 — 앱 edgeKey 와 같은 값. */
    static long edgeKey(int a, int b, int n) {
        return a < b ? (long) a * n + b : (long) b * n + a;
    }

    // 앱 loadNav 와 같은 순서(index 오름차순 시작 · DIRS 순 BFS)로 라벨을 붙인다.
    private int[] labelRegions() {
        int n = walkable.length;
        int[] labels = new int[n];
        Arrays.fill(labels, -1);
        int[] queue = new int[n];
        int label = 0;
        for (int s = 0; s < n; s++) {
            if (!walkable[s] || labels[s] >= 0) {
                continue;
            }
            labels[s] = label;
            int head = 0;
            int tail = 0;
            queue[tail++] = s;
            while (head < tail) {
                int p = queue[head++];
                for (int[] d : DIRS) {
                    int q = neighbor(p, d[0], d[1]);
                    if (q >= 0 && labels[q] < 0) {
                        labels[q] = label;
                        queue[tail++] = q;
                    }
                }
            }
            label++;
        }
        return labels;
    }
}

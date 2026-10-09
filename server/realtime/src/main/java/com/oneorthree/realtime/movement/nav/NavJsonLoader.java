package com.oneorthree.realtime.movement.nav;

import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * nav.json(NavArtifact 모양) → {@link NavGrid}. 검증은 앱 {@code loadNav} 와 같다 — 크기는 양의 정수, walkable·
 * traversalCost 길이는 columns×rows, 비용은 양수. 어기면 {@link IllegalArgumentException}.
 *
 * <p>번들 파일 {@value #BUNDLED} 는 앱 {@code app/app-dev/src/assets/village-world/v1/nav.json} 의 바이트 복사본이다
 * (같은 폴더 README, {@code NavJsonParityTest} 가 sha256 일치를 지킨다).
 */
public final class NavJsonLoader {

    /** classpath 상의 번들 nav 경로. */
    public static final String BUNDLED = "movement/nav.json";

    // 앱은 비용을 Uint8Array 에 담는다 — 256 이상이면 앱만 조용히 다른 값이 되므로 서버는 읽을 때 거부한다.
    private static final int MAX_COST_TENTHS = 255;

    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    private NavJsonLoader() {
    }

    /**
     * classpath 의 {@value #BUNDLED} 를 읽는다. 없으면 배포 산출물이 깨진 것이라 {@link IllegalStateException}.
     * 번들은 반드시 100×100(MV-D01) 이어야 한다 — 아니면 {@link IllegalArgumentException}.
     */
    public static NavGrid loadBundled() {
        try (InputStream in = NavJsonLoader.class.getClassLoader().getResourceAsStream(BUNDLED)) {
            if (in == null) {
                throw new IllegalStateException("classpath 에 " + BUNDLED + " 가 없다");
            }
            NavGrid grid = load(in);
            requireBundledSize(grid);
            return grid;
        } catch (IOException e) {
            throw new UncheckedIOException(BUNDLED + " 를 읽지 못했다", e);
        }
    }

    // 번들 전용 크기 가드(MV-D01). package-private 로 둬 테스트가 classpath 리소스 없이 직접 검증한다.
    // 리뷰: WorldCoords.worldToCell 의 고정 상한(99) 에 기대는 코드가 많아 번들만은 100×100 을 강제한다.
    static void requireBundledSize(NavGrid grid) {
        if (grid.cols() != WorldCoords.WORLD_SIZE || grid.rows() != WorldCoords.WORLD_SIZE) {
            throw new IllegalArgumentException(
                    "nav 가 MV-D01 100×100 이 아니다: " + grid.cols() + "x" + grid.rows());
        }
    }

    public static NavGrid load(InputStream in) {
        JsonNode root;
        try {
            root = JSON.readTree(in);
        } catch (JacksonException e) {
            throw new IllegalArgumentException("nav.json 이 올바른 JSON 이 아니다: " + e.getOriginalMessage(), e);
        }
        return fromJson(root);
    }

    static NavGrid fromJson(JsonNode nav) {
        int cols = positiveInt(nav, "columns");
        int rows = positiveInt(nav, "rows");
        long n = (long) cols * rows;
        JsonNode walk = nav.path("walkable");
        if (!walk.isString()) {
            throw new IllegalArgumentException("nav.walkable 은 \"0\"/\"1\" 문자열이어야 한다");
        }
        String w = walk.stringValue();
        if (w.length() != n) {
            throw new IllegalArgumentException("nav.walkable 길이 " + w.length() + " != columns*rows " + n);
        }
        JsonNode cost = nav.path("traversalCost");
        if (!cost.isArray() || cost.size() != n) {
            throw new IllegalArgumentException("nav.traversalCost 길이 " + cost.size() + " != columns*rows " + n);
        }
        boolean[] walkable = new boolean[(int) n];
        int[] costTenths = new int[(int) n];
        for (int i = 0; i < n; i++) {
            JsonNode c = cost.get(i);
            // 미완공 건물 자리가 켜질 수 있어 차단 셀도 비용이 있어야 한다(앱과 같은 이유).
            if (!c.isInt() || c.intValue() <= 0 || c.intValue() > MAX_COST_TENTHS) {
                throw new IllegalArgumentException(
                        "nav.traversalCost[" + i + "] 가 " + c + " (1~" + MAX_COST_TENTHS + " 정수만)");
            }
            costTenths[i] = c.intValue();
            walkable[i] = w.charAt(i) == '1';
        }
        // ponytail: 서버는 완공 목록을 모른다 — buildingCells 를 쓰는 nav 가 오면 앱(완공 목록별 격자)과 갈라지므로
        // 조용히 무시하지 않고 거부한다. 쓰게 되면 앱 loadNav(nav, completedBuildings) 처럼 칸을 켠다.
        for (JsonNode cells : nav.path("buildingCells")) {
            if (!cells.isEmpty()) {
                throw new IllegalArgumentException(
                        "nav.buildingCells 는 아직 지원하지 않는다(전부 빈 배열이어야 한다) — "
                                + "앱이 buildingCells 를 쓰기 시작했다면 NavArtifact(2단계) 가 필요하다");
            }
        }
        Set<Long> blocked = new HashSet<>();
        for (JsonNode edge : nav.path("blockedEdges")) {
            if (edge.size() != 2 || !edge.get(0).isInt() || !edge.get(1).isInt()) {
                throw new IllegalArgumentException("nav.blockedEdges 원소는 [a, b] 정수 쌍이어야 한다: " + edge);
            }
            int a = edge.get(0).intValue();
            int b = edge.get(1).intValue();
            // 리뷰: 범위(0<=i<n)·순서(a<b) 를 어기면 edgeKey 로 바로 넣지 않고 거부한다.
            if (a < 0 || a >= n || b < 0 || b >= n || a >= b) {
                throw new IllegalArgumentException("nav.blockedEdges 원소가 올바르지 않다(0<=a<b<n): " + edge);
            }
            blocked.add(NavGrid.edgeKey(a, b, (int) n));
        }
        return new NavGrid(cols, rows, walkable, costTenths, blocked,
                cells(nav, "entrances", cols, rows, walkable), cells(nav, "spawns", cols, rows, walkable));
    }

    private static int positiveInt(JsonNode nav, String field) {
        JsonNode v = nav.path(field);
        if (!v.isInt() || v.intValue() <= 0) {
            throw new IllegalArgumentException("nav." + field + " 는 양의 정수여야 한다: " + v);
        }
        return v.intValue();
    }

    private static Map<String, Cell> cells(JsonNode nav, String field, int cols, int rows, boolean[] walkable) {
        Map<String, Cell> out = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> e : nav.path(field).properties()) {
            JsonNode cx = e.getValue().path("cx");
            JsonNode cy = e.getValue().path("cy");
            if (!cx.isInt() || !cy.isInt()) {
                throw new IllegalArgumentException("nav." + field + "." + e.getKey() + " 는 {cx, cy} 정수여야 한다");
            }
            int x = cx.intValue();
            int y = cy.intValue();
            // 리뷰: 격자 밖 입구/스폰 좌표가 조용히 틀린 셀로 쓰이지 않게 거부한다.
            if (x < 0 || x >= cols || y < 0 || y >= rows) {
                throw new IllegalArgumentException(
                        "nav." + field + "." + e.getKey() + " 가 격자 밖 (" + x + "," + y + ")");
            }
            // 계약: entrances 는 비통행이어도 Pathfinder.resolveTarget 의 목적지 보정이 출발 영역 안 최근접 셀로
            // 바로잡는다 — spawns 는 출발 영역 자체를 정하는 기준점이라 비통행이면 전역 최근접 보정이 다른 섬으로
            // 튈 수 있어 거부한다.
            if (field.equals("spawns") && !walkable[y * cols + x]) {
                throw new IllegalArgumentException(
                        "nav." + field + "." + e.getKey() + " 가 비통행 셀이다: (" + x + "," + y + ")");
            }
            out.put(e.getKey(), new Cell(x, y));
        }
        return out;
    }
}

package com.oneorthree.realtime.movement.nav;

import com.oneorthree.realtime.movement.nav.Pathfinder.PathResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 앱 A*({@code nav-path.ts})와 결과가 비트 단위로 같은지 — 공통 fixture 를 그대로 읽어 단언한다(티켓 2245 완료 조건 2).
 *
 * <p>fixture 는 앱 테스트가 만든다({@code cd app/app-dev && npm run gen:path-fixture}). 파일이 없으면 건너뛰지 않고
 * 실패한다 — 건너뛰면 «앱과 같다»는 보장이 조용히 사라진다. Gradle 테스트의 작업 디렉터리는 {@code server/realtime}.
 */
class PathfinderTest {

    private static final Path FIXTURE = Path.of("../../docs/prd/fishcat/island-movement/fixtures/paths.json");
    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** 비교 단위 — 실패하면 케이스 전체가 한 번에 diff 로 보인다. */
    private record Outcome(Cell start, Cell goal, long cost, List<Cell> path) {
    }

    @Test
    @DisplayName("fixture 의 navSha256 은 서버 번들 nav.json 의 sha256 이고 케이스는 20건 이상이다")
    void fixtureIsForBundledNav() throws IOException {
        JsonNode fixture = readFixture();

        assertThat(fixture.path("navSha256").stringValue())
                .as("fixture 가 다른 nav 로 만들어졌다 — 앱에서 npm run gen:path-fixture 후 nav.json 복사본도 맞춘다")
                .isEqualTo(NavJsonParityTest.sha256(NavJsonParityTest.bundledBytes()));
        assertThat(fixture.path("cases").size()).isGreaterThanOrEqualTo(20);
    }

    @TestFactory
    @DisplayName("공통 fixture 의 케이스마다 출발·목적지·비용·경로가 앱 A* 와 같다")
    Stream<DynamicTest> matchesAppForEveryCase() throws IOException {
        NavGrid bundled = NavJsonLoader.loadBundled();
        return readFixture().path("cases").valueStream()
                .map(c -> DynamicTest.dynamicTest(c.path("name").stringValue(), () -> assertCase(c, bundled)));
    }

    @Test
    @DisplayName("목적지가 비유한값이면 보정하지 않고 빈 값이다(앱 resolveTarget 과 같다)")
    void nonFiniteTargetIsEmpty() {
        NavGrid g = NavJsonLoader.loadBundled();

        assertThat(Pathfinder.find(g, new WorldPoint(38.5, 45.5), new WorldPoint(Double.NaN, 10))).isEmpty();
        assertThat(Pathfinder.resolveTarget(g, new WorldPoint(38.5, 45.5), new WorldPoint(10, Double.POSITIVE_INFINITY)))
                .isEmpty();
    }

    private static void assertCase(JsonNode c, NavGrid bundled) {
        NavGrid g = c.has("inlineNav") ? NavJsonLoader.fromJson(c.get("inlineNav")) : bundled;
        Optional<PathResult> r = Pathfinder.find(g, point(c.get("from")), point(c.get("to")));
        if (c.path("unreachable").asBoolean(false)) {
            assertThat(r).isEmpty();
            return;
        }
        assertThat(r).isPresent();
        PathResult p = r.get();
        List<Cell> path = new ArrayList<>();
        for (int i : p.cells()) {
            path.add(g.cellOf(i));
        }
        List<Cell> expectedPath = new ArrayList<>();
        for (JsonNode pair : c.path("path")) {
            expectedPath.add(new Cell(pair.get(0).intValue(), pair.get(1).intValue()));
        }

        assertThat(new Outcome(g.cellOf(p.startIndex()), g.cellOf(p.goalIndex()), p.cost(), path))
                .isEqualTo(new Outcome(cell(c.get("start")), cell(c.get("goal")), c.get("cost").longValue(),
                        expectedPath));
    }

    private static JsonNode readFixture() throws IOException {
        assertThat(FIXTURE).as("공통 A* fixture 가 없다 — %s", FIXTURE.toAbsolutePath().normalize()).isRegularFile();
        return JSON.readTree(Files.readAllBytes(FIXTURE));
    }

    private static WorldPoint point(JsonNode n) {
        return new WorldPoint(n.get("x").asDouble(), n.get("y").asDouble());
    }

    private static Cell cell(JsonNode n) {
        return new Cell(n.get("cx").intValue(), n.get("cy").intValue());
    }
}

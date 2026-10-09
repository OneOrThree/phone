package com.oneorthree.realtime.movement.nav;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 서버가 읽는 통행 격자가 앱과 <b>같은 파일</b>인지 지킨다(티켓 2245 완료 조건 1).
 *
 * <p>번들 {@code movement/nav.json} 은 앱 원본의 복사본이라, 앱 쪽만 다시 생성하면 서버는 옛 격자로 길을 찾는다 —
 * 그래도 양쪽 테스트는 각자 초록이다. 이 클래스가 sha256 을 맞대어 그 어긋남을 실패로 만든다.
 * Gradle 테스트의 작업 디렉터리는 {@code server/realtime} 이다.
 */
class NavJsonParityTest {

    static final Path APP_NAV = Path.of("../../app/app-dev/src/assets/village-world/v1/nav.json");

    @Test
    @DisplayName("서버 리소스 movement/nav.json 은 앱 v1/nav.json 과 sha256 이 같다")
    void bundledCopyMatchesApp() throws IOException {
        assertThat(APP_NAV).as("앱 nav.json 이 없다 — %s", APP_NAV.toAbsolutePath().normalize()).isRegularFile();

        assertThat(sha256(bundledBytes()))
                .as("앱 nav.json 이 바뀌었다 — 레포 루트에서 cp app/app-dev/src/assets/village-world/v1/nav.json "
                        + "server/realtime/src/main/resources/movement/nav.json")
                .isEqualTo(sha256(Files.readAllBytes(APP_NAV)));
    }

    @Test
    @DisplayName("번들 nav.json 은 100×100 · 통행 3,776칸 · 최소 비용 27 · 입구 7곳 · 스폰 (38,45) 로 읽힌다")
    void loadsBundledGrid() {
        NavGrid g = NavJsonLoader.loadBundled();

        int open = 0;
        for (int i = 0; i < g.size(); i++) {
            open += g.walkable(i) ? 1 : 0;
        }
        assertThat(g.cols()).isEqualTo(100);
        assertThat(g.rows()).isEqualTo(100);
        assertThat(open).isEqualTo(3776);
        assertThat(g.minCostTenths()).isEqualTo(27);
        assertThat(g.entrances()).containsOnlyKeys("hall", "library", "shop", "tower", "board", "gram", "mail");
        assertThat(g.entrances()).containsEntry("hall", new Cell(67, 27));
        assertThat(g.spawns()).containsEntry("character", new Cell(38, 45));
        for (Cell c : g.entrances().values()) {
            assertThat(g.region(g.index(c))).as("입구 %s 는 스폰과 같은 영역", c)
                    .isEqualTo(g.region(g.index(g.spawns().get("character"))));
        }
    }

    @Test
    @DisplayName("walkable 길이가 columns*rows 와 다르면 거부한다(앱 loadNav 와 같은 검증)")
    void rejectsWalkableLengthMismatch() {
        assertThatThrownBy(() -> load("{\"columns\":2,\"rows\":2,\"walkable\":\"111\",\"traversalCost\":[10,10,10,10]}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("walkable");
    }

    @Test
    @DisplayName("비용이 0 인 칸이 있으면 그 index 를 밝혀 거부한다(앱 loadNav 와 같은 검증)")
    void rejectsNonPositiveCost() {
        assertThatThrownBy(() -> load("{\"columns\":2,\"rows\":1,\"walkable\":\"11\",\"traversalCost\":[10,0]}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("traversalCost[1]");
    }

    @Test
    @DisplayName("앱 Uint8Array 에 못 담는 비용(256 이상)은 앱과 값이 갈라지므로 거부한다")
    void rejectsCostAboveUint8() {
        assertThatThrownBy(() -> load("{\"columns\":2,\"rows\":1,\"walkable\":\"11\",\"traversalCost\":[10,300]}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("traversalCost[1]");
    }

    @Test
    @DisplayName("buildingCells 가 비어 있지 않으면 거부한다 — 서버는 완공 목록을 모른다")
    void rejectsNonEmptyBuildingCells() {
        assertThatThrownBy(() -> load("{\"columns\":2,\"rows\":1,\"walkable\":\"11\",\"traversalCost\":[10,10],"
                + "\"buildingCells\":{\"hall\":[1]}}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("buildingCells");
    }

    private static NavGrid load(String json) {
        return NavJsonLoader.load(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }

    static byte[] bundledBytes() throws IOException {
        try (InputStream in = NavJsonLoader.class.getClassLoader().getResourceAsStream(NavJsonLoader.BUNDLED)) {
            assertThat(in).as("classpath 에 %s 가 없다", NavJsonLoader.BUNDLED).isNotNull();
            return in.readAllBytes();
        }
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}

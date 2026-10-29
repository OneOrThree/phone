package com.oneorthree.notification;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class CatalogIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }
    @Autowired Renderer renderer;
    @Autowired Store store;
    @Autowired InboundService inbound;
    @MockitoBean PushTransport transport;




    @Test
    void eventKindsRenderInAllFourLocalesAndPublicationKindUsesFrozenCopy() {
        Map<String, Object> params = inputs();
        List<Map<String, Object>> kinds = store.rows("SELECT id,silent FROM kinds WHERE enabled AND id <> 'ADMIN_ANNOUNCEMENT'");
        assertThat(kinds).hasSize(5);
        assertThat(store.one("SELECT silent,quiet_policy FROM kinds WHERE id='ADMIN_ANNOUNCEMENT'"))
                .containsEntry("silent", false).containsEntry("quiet_policy", "DEFER");
        assertThat(store.rows("SELECT id FROM templates WHERE enabled")).hasSize(20);
        for (Map<String, Object> kind : kinds) {
            for (String locale : List.of("ko", "en", "ja", "zh-Hant")) {
                RenderedPush push = renderer.render(kind.get("id").toString(), locale, params);
                assertThat(push.silent()).isEqualTo(kind.get("silent"));
                if (push.silent()) {
                    assertThat(push.title()).isNull();
                    assertThat(push.data()).containsEntry("silent", "flush");
                } else {
                    assertThat(push.title()).isNotBlank().doesNotContain("{");
                    assertThat(push.body()).isNotBlank().doesNotContain("{");
                }
            }
        }
    }

    /**
     * 켜진 알림 4종은 닉네임·섬 이름을 문구에 싣지 않는다(GROMO-2519, V12) — producer 가 두 값을 계속 보내도
     * 4로케일 어디에도 새어 나오면 안 된다. 「친구」 같은 흔한 말은 문구와 우연히 겹치므로 구별되는 값을 쓴다.
     * 16행이 전부 갱신됐는지(version 이 시드의 1 에서 올랐는지)도 본다 — 렌더만으로는 ko 폴백이 빠진 로케일을
     * 가리고 version 증가도 못 본다.
     */
    @Test
    void deidentifiedKindsRenderNeitherNicknameNorIslandNameInAnyLocale() {
        Map<String, Object> params = new LinkedHashMap<>(inputs());
        params.put("counterpartNickname", "닉네임X");
        params.put("islandName", "섬이름X");
        List<String> kinds = List.of("FRIEND_REQUEST", "FRIEND_ACCEPTED", "MAIN_ISLAND_TRANSFERRED", "ISLAND_KICKED");
        for (String kind : kinds) {
            for (String locale : List.of("ko", "en", "ja", "zh-Hant")) {
                RenderedPush push = renderer.render(kind, locale, params);
                assertThat(push.title() + "\n" + push.body()).as(kind + "." + locale)
                        .doesNotContain("닉네임X", "섬이름X", "{");
            }
        }
        assertThat(store.rows("SELECT id FROM templates WHERE version > 1 AND kind IN (?,?,?,?)", kinds.toArray()))
                .hasSize(16);
    }

    /**
     * 메인 섬 자동 이전(GROMO-1971)을 <b>실제 카탈로그로</b> 받아 본다.
     *
     * <p>producer 가 kind 를 늘렸는데 이 카탈로그가 비어 있으면 {@code enqueue} 가 422
     * {@code UNKNOWN_NOTIFICATION_KIND} 를 던지고 사건이 재시도 끝에 DLT 로 간다 — 「CI 는 초록인데
     * OUTBOX 로 켜는 순간 전부 유실」이 되는 자리라 <b>수신까지</b> 고정한다. 여기서 kind 행을 손으로
     * 넣지 않는 것이 요점이다: 스텁을 깔면 카탈로그 누락을 영영 못 잡는다.
     * 문구에는 V12(GROMO-2519) 부터 섬 이름이 없다.
     */
    @Test
    void mainIslandTransferIsAcceptedByTheRealCatalogAndRendersWithoutTheIslandName() {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", "noti:MAIN_ISLAND_TRANSFERRED:catalog-check");
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", "44444444-4444-4444-8444-444444444444");
        event.put("version", 1L);
        event.put("locale", "ko");
        event.put("subjectId", "33333333-3333-4333-8333-333333333333");
        event.put("occurredAt", "2026-09-20T12:00:00Z");
        event.put("params", Map.of("kind", "MAIN_ISLAND_TRANSFERRED",
                "islandId", "33333333-3333-4333-8333-333333333333", "islandName", "모래섬"));

        inbound.accept(event);

        Map<String, Object> delivery = store.one(
                "SELECT kind,subject_id FROM deliveries WHERE event_id=?", event.get("eventId"));
        assertThat(delivery).isNotNull();
        assertThat(delivery.get("kind")).isEqualTo("MAIN_ISLAND_TRANSFERRED");
        // 결정적 키의 대상 축이 그대로 실려야 연속 이전이 한 건으로 접히지 않는다.
        assertThat(delivery.get("subject_id").toString()).isEqualTo("33333333-3333-4333-8333-333333333333");

        RenderedPush push = renderer.render("MAIN_ISLAND_TRANSFERRED", "ko", inputs());
        assertThat(push.title()).isEqualTo("메인 섬이 바뀌었어요");
        assertThat(push.body()).isEqualTo("떠난 섬 대신 새 메인 섬이 정해졌어요");
        // 딥링크는 구 경로가 쓰는 gromo://group?g=<islandId> 와 같아야 한다 — 컷오버에서 라우팅이 바뀌면 안 된다.
        assertThat(push.data()).containsEntry("link", "gromo://group?g=33333333-3333-4333-8333-333333333333")
                .containsEntry("type", "MAIN_ISLAND_TRANSFERRED");
    }

    /** 섬 강퇴(GROMO-2315) — V9 카탈로그가 사건을 받고, V12(GROMO-2519) 부터 섬 이름 없는 문장과 홈 딥링크로 렌더한다. */
    @Test
    void islandKickedIsAcceptedByTheRealCatalogAndRendersWithoutTheIslandName() {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", "noti:ISLAND_KICKED:catalog-check");
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", "44444444-4444-4444-8444-444444444444");
        event.put("version", 1L);
        event.put("locale", "ko");
        event.put("subjectId", "33333333-3333-4333-8333-333333333333");
        event.put("occurredAt", "2026-10-20T12:00:00Z");
        event.put("params", Map.of("kind", "ISLAND_KICKED",
                "islandId", "33333333-3333-4333-8333-333333333333", "islandName", "모래섬"));

        inbound.accept(event);

        Map<String, Object> delivery = store.one(
                "SELECT kind,subject_id FROM deliveries WHERE event_id=?", event.get("eventId"));
        assertThat(delivery).isNotNull();
        assertThat(delivery.get("kind")).isEqualTo("ISLAND_KICKED");
        assertThat(delivery.get("subject_id").toString()).isEqualTo("33333333-3333-4333-8333-333333333333");

        RenderedPush push = renderer.render("ISLAND_KICKED", "ko", inputs());
        assertThat(push.title()).isEqualTo("섬에서 나가게 되었어요");
        assertThat(push.body()).isEqualTo("그 섬에서 더 이상 함께할 수 없게 되었어요");
        assertThat(push.data()).containsEntry("link", "gromo://home").containsEntry("type", "ISLAND_KICKED");
        for (String locale : List.of("ko", "en", "ja", "zh-Hant")) {
            RenderedPush localized = renderer.render("ISLAND_KICKED", locale, inputs());
            assertThat(localized.title()).as(locale).isNotBlank();
            assertThat(localized.body()).as(locale).doesNotContain("모래섬", "{");
        }
    }

    /** 잡지 발행(GROMO-2307) — V8 카탈로그가 사건을 받고 4로케일·딥링크·data.type 으로 렌더한다. */
    @Test
    void magazinePublishedIsAcceptedByTheRealCatalogAndRendersIssueNoAndLink() {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", "noti:MAGAZINE_PUBLISHED:catalog-check");
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", "44444444-4444-4444-8444-444444444444");
        event.put("version", 1L);
        event.put("locale", "ko");
        event.put("subjectId", "55555555-5555-4555-8555-555555555555");
        event.put("occurredAt", "2026-10-18T07:00:00Z");
        event.put("params", Map.of("kind", "MAGAZINE_PUBLISHED",
                "issueId", "55555555-5555-4555-8555-555555555555", "issueNo", "7", "issueDate", "2026-10-18"));

        inbound.accept(event);

        Map<String, Object> delivery = store.one(
                "SELECT kind,subject_id FROM deliveries WHERE event_id=?", event.get("eventId"));
        assertThat(delivery).isNotNull();
        assertThat(delivery.get("kind")).isEqualTo("MAGAZINE_PUBLISHED");

        RenderedPush push = renderer.render("MAGAZINE_PUBLISHED", "ko", inputs());
        assertThat(push.title()).isEqualTo("오늘의 고양이 잡지가 왔어요");
        assertThat(push.body()).isEqualTo("냐옹 7호가 나왔어요 — 새 섬 소식을 확인해 보세요");
        assertThat(push.data()).containsEntry("link", "gromo://magazine?issue=55555555-5555-4555-8555-555555555555")
                .containsEntry("type", "MAGAZINE_PUBLISHED");
        assertThat(renderer.render("MAGAZINE_PUBLISHED", "en", inputs()).title()).isEqualTo("Today's Cat Magazine is here");
        for (String locale : List.of("ko", "en", "ja", "zh-Hant")) {
            RenderedPush localized = renderer.render("MAGAZINE_PUBLISHED", locale, inputs());
            assertThat(localized.title()).as(locale).isNotBlank();
            assertThat(localized.body()).as(locale).contains("7").doesNotContain("{");
            assertThat(localized.data()).as(locale)
                    .containsEntry("link", "gromo://magazine?issue=55555555-5555-4555-8555-555555555555");
        }
    }

    private static Map<String, Object> inputs() {
        return Map.of("counterpartNickname", "친구", "islandId", "33333333-3333-4333-8333-333333333333",
                "islandName", "모래섬", "issueId", "55555555-5555-4555-8555-555555555555", "issueNo", "7");
    }
}

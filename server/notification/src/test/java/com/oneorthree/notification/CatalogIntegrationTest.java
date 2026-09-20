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
    void challengeGoalUsesAllFourTemplateLanguages() {
        Map<String, Object> params = inputs();
        params.put("mission", Map.of("type", "DURATION", "category", "FOCUS", "durationMinutes", 30));
        Map<String, String> expected = Map.of("ko", "하루 30분 집중", "en", "30 min focus per day",
                "ja", "毎日30分の集中", "zh-Hant", "每天30分鐘專注");
        expected.forEach((locale, goal) -> assertThat(renderer.render("CHALLENGE_CREATED", locale, params).body())
                .startsWith(goal));
        assertThat(params).containsEntry("missionLabel", "20분 집중");
    }

    @Test
    void challengeWindowKeepsDaysTimesAndCategoryInRecipientLanguage() {
        Map<String, Object> params = inputs();
        Map<String, Object> mission = new LinkedHashMap<>(Map.of("type", "TIME_WINDOW", "category", "SCREEN_TIME",
                "repeatDays", List.of("MON", "WED", "FRI"), "windowStart", "21:00", "windowEnd", "23:30",
                "durationMinutes", 30));
        params.put("mission", mission);
        Map<String, String> expected = Map.of("ko", "월·수·금 21:00~23:30 30분 스크린타임",
                "en", "Mon·Wed·Fri 21:00~23:30 30 min screen time",
                "ja", "月·水·金 21:00~23:30 30分のスクリーンタイム",
                "zh-Hant", "週一·週三·週五 21:00~23:30 30分鐘螢幕使用時間");
        expected.forEach((locale, goal) -> assertThat(renderer.render("CHALLENGE_CREATED", locale, params).body())
                .startsWith(goal));
        mission.remove("durationMinutes");
        assertThat(renderer.render("CHALLENGE_CREATED", "en", params).body())
                .startsWith("Mon·Wed·Fri 21:00~23:30 screen time");
    }

    @Test
    void challengeGoalUsesActualFallbackTemplateLanguageAndMissingDetailStaysHonest() {
        Map<String, Object> params = inputs();
        params.put("mission", Map.of("type", "DURATION", "category", "FOCUS"));
        assertThat(renderer.render("CHALLENGE_CREATED", "en", params).body()).startsWith("focus time");
        store.update("UPDATE templates SET enabled=false WHERE kind='CHALLENGE_CREATED' AND locale='en'");
        try {
            assertThat(renderer.render("CHALLENGE_CREATED", "en", params).body()).startsWith("집중 시간");
        } finally {
            store.update("UPDATE templates SET enabled=true WHERE kind='CHALLENGE_CREATED' AND locale='en'");
        }
    }

    @Test
    void actualFourLocaleCatalogRendersEveryKindIncludingSilentAndBundles() {
        Map<String, Object> params = inputs();
        List<Map<String, Object>> kinds = store.rows("SELECT id,silent FROM kinds");
        assertThat(kinds).hasSize(24);
        assertThat(store.rows("SELECT id FROM templates")).hasSize(96);
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
     * 메인 섬 자동 이전(GROMO-1971)을 <b>실제 카탈로그로</b> 받아 본다.
     *
     * <p>producer 가 kind 를 늘렸는데 이 카탈로그가 비어 있으면 {@code enqueue} 가 422
     * {@code UNKNOWN_NOTIFICATION_KIND} 를 던지고 사건이 재시도 끝에 DLT 로 간다 — 「CI 는 초록인데
     * OUTBOX 로 켜는 순간 전부 유실」이 되는 자리라 <b>수신까지</b> 고정한다. 여기서 kind 행을 손으로
     * 넣지 않는 것이 요점이다: 스텁을 깔면 카탈로그 누락을 영영 못 잡는다.
     */
    @Test
    void mainIslandTransferIsAcceptedByTheRealCatalogAndRendersItsIslandName() {
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
        assertThat(push.body()).isEqualTo("떠난 섬 대신 새 메인 섬이 정해졌어요 — 모래섬");
        // 딥링크는 구 경로가 쓰는 gromo://group?g=<islandId> 와 같아야 한다 — 컷오버에서 라우팅이 바뀌면 안 된다.
        assertThat(push.data()).containsEntry("link", "gromo://group?g=33333333-3333-4333-8333-333333333333")
                .containsEntry("type", "MAIN_ISLAND_TRANSFERRED");
    }

    @Test
    void forfeiturePrecedesAchievementAndLegacyRefundNullHasRealFallback() {
        Map<String, Object> params = inputs();
        params.put("betStatus", "FORFEITED");
        params.put("achieved", false);
        assertThat(renderer.render("BET_RESULT", "ko", params).body())
                .isEqualTo("아무도 목표를 달성하지 못해 참가비가 소멸됐어요");
        params.put("betStatus", "SETTLED");
        params.put("achieved", true);
        assertThat(renderer.render("BET_RESULT", "ko", params).body()).contains("이겼어요", "120");
        params.put("achieved", false);
        assertThat(renderer.render("BET_RESULT", "ko", params).body()).contains("목표 미달성", "100");
        params.put("voidReason", null);
        RenderedPush refund = renderer.render("BET_VOID_REFUND", "ko", params);
        assertThat(refund.body()).isEqualTo("내기가 무산돼 참가비를 돌려드렸어요");
        assertThat(refund.data()).doesNotContainKey("voidReason").doesNotContainKey("link");
    }

    @Test
    void tierAndDurationAreDerivedAndWeeklyRelegationKeepsFocusRoute() {
        Map<String, Object> params = inputs();
        params.put("result", "RELEGATED");
        assertThat(renderer.render("LEAGUE_WEEKLY_RESULT", "ko", params).body())
                .contains("예열 모드", "뽀시래기");
        assertThat(renderer.render("LEAGUE_WEEKLY_RESULT", "ko", params).data())
                .containsEntry("link", "gromo://focus");
        for (int seconds : new int[]{1, 60, 3600, 3661}) {
            params.put("shortfallSeconds", seconds);
            String expected = seconds <= 60 ? "1분" : seconds == 3600 ? "1시간" : "1시간 2분";
            assertThat(renderer.render("LEAGUE_RELEGATION_WARNING", "ko", params).body()).contains(expected);
        }
        assertThat(renderer.render("BET_WON", null, params))
                .isEqualTo(renderer.render("BET_WON", "ko", params));
    }

    private static Map<String, Object> inputs() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("groupId", "11111111-1111-4111-8111-111111111111");
        params.put("challengeId", "22222222-2222-4222-8222-222222222222");
        params.put("result", "PROMOTED");
        params.put("previousTierLevel", 2);
        params.put("newTierLevel", 1);
        params.put("rank", 3);
        params.put("shortfallSeconds", 61);
        params.put("stage", "D3");
        params.put("streakCount", 5);
        params.put("betStatus", "SETTLED");
        params.put("achieved", true);
        params.put("payout", 120);
        params.put("stake", 100);
        params.put("voidReason", "CHALLENGE_DELETED");
        params.put("groupName", "그룹");
        params.put("missionLabel", "20분 집중");
        params.put("counterpartNickname", "친구");
        params.put("islandId", "33333333-3333-4333-8333-333333333333");
        params.put("islandName", "모래섬");
        params.put("count", 3);
        params.put("resultCount", 2);
        params.put("refundCount", 1);
        return params;
    }
}

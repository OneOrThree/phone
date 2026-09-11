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
    @MockitoBean PushTransport transport;

    @Test
    void actualFourLocaleCatalogRendersEveryKindIncludingSilentAndBundles() {
        Map<String, Object> params = inputs();
        List<Map<String, Object>> kinds = store.rows("SELECT id,silent FROM kinds");
        assertThat(kinds).hasSize(23);
        assertThat(store.rows("SELECT id FROM templates")).hasSize(92);
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
        params.put("count", 3);
        params.put("resultCount", 2);
        params.put("refundCount", 1);
        return params;
    }
}

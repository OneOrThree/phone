package com.oneorthree.phone.appearance.support;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardItem;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSessionKind;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/**
 * 꾸미기 보상 추첨 산식 (GROMO-2301) — 등록 데이터(reward-catalog-v1.json)의 정책과 엑셀에서 뽑은 정답
 * ({@code server/scripts/customization/probability-fixtures.json})을 그대로 읽어 맞댄다. 파이썬 검증기와 같은 정답이다.
 */
class CustomizationRewardDrawTest {

    private static final Set<String> CAT_CATEGORIES = Set.of("head", "neck");
    private static final FocusSessionKind[] LOCATIONS = FocusSessionKind.values();

    private static final ObjectMapper JSON = new ObjectMapper();
    /** 등록 데이터의 정책 원본 — 시험용 정책을 만들 때 쓴다. */
    private static JsonNode policyJson;
    /** revision 1 — 9분류 전부. */
    private static CustomizationRewardPolicy everyCategory;
    /** revision 2(V135) — 같은 확률, 머리·목만. */
    private static CustomizationRewardPolicy catOnly;
    /** 90종 — 신발 10·뗏목 60종 포함. */
    private static List<CustomizationRewardItem> allItems;

    @BeforeAll
    static void loadCatalog() throws IOException {
        JsonNode bundle;
        try (InputStream in = CustomizationRewardDrawTest.class
                .getResourceAsStream("/customization/reward-catalog-v1.json")) {
            bundle = JSON.readTree(in);
        }
        JsonNode policy = bundle.get("policy");
        policyJson = policy;
        Map<String, Object> locationWeights = JSON.convertValue(policy.get("locationWeights"),
                new TypeReference<>() { });
        Map<String, Object> categoryWeights = JSON.convertValue(policy.get("categoryWeights"),
                new TypeReference<>() { });
        everyCategory = policy(policy, policy.get("revision").asInt(), locationWeights, categoryWeights);
        Map<String, Object> catWeights = new HashMap<>(categoryWeights);
        catWeights.keySet().retainAll(CAT_CATEGORIES);
        catOnly = policy(policy, 2, locationWeights, catWeights);
        allItems = new ArrayList<>();
        bundle.get("items").forEach(item -> allItems.add(CustomizationRewardItem.builder()
                .revision(everyCategory.getRevision())
                .productId(item.get("productId").asText())
                .category(item.get("category").asText())
                .rarity(item.get("rarity").asText())
                .sortOrder(item.get("sortOrder").asInt())
                .build()));
        assertThat(allItems).hasSize(90);
    }

    @Test
    @DisplayName("엑셀 정답 13개 시간 × 두 장소의 등급 확률과 1e-12 안에서 같다")
    void matchesWorkbookFixtures() throws IOException {
        JsonNode fixtures = JSON.readTree(Files.readString(
                Path.of("../scripts/customization/probability-fixtures.json")));
        assertThat(fixtures.get("cases")).hasSize(13);
        for (JsonNode fixture : fixtures.get("cases")) {
            long seconds = fixture.get("activeSeconds").asLong();
            for (FocusSessionKind location : LOCATIONS) {
                Map<String, Double> computed = CustomizationRewardDraw.probabilities(everyCategory, location, seconds);
                for (int i = 0; i < CustomizationRewardDraw.RARITIES.size(); i++) {
                    String rarity = CustomizationRewardDraw.RARITIES.get(i);
                    assertThat(computed.get(rarity)).as("%s %d초 %s", location, seconds, rarity)
                            .isCloseTo(fixture.get(location.name()).get(i).asDouble(), within(1e-12));
                }
            }
        }
    }

    @Test
    @DisplayName("15분 미만은 전부 0, 15분부터는 합이 1이고 모든 확률이 0~1 이다")
    void sumsToOneFromFifteenMinutes() {
        Set<Long> seconds = new TreeSet<>(List.of(0L, 899L, 900L, 901L, 1799L, 1800L, 3599L, 3600L, 86_400L,
                1_000_000_000L));
        for (long s = 0; s <= 14_400; s += 60) {
            seconds.add(s);
        }
        for (long s : seconds) {
            for (FocusSessionKind location : LOCATIONS) {
                Map<String, Double> p = CustomizationRewardDraw.probabilities(everyCategory, location, s);
                assertThat(p.values().stream().mapToDouble(Double::doubleValue).sum()).as("%s %d초", location, s)
                        .isCloseTo(s >= 900 ? 1.0 : 0.0, within(1e-12));
                assertThat(p.values()).allSatisfy(value -> assertThat(value).isBetween(0.0, 1.0));
            }
        }
    }

    @Test
    @DisplayName("희귀는 1800초, 전설은 3600초에 열린다 — 1초 전에는 0")
    void unlockBoundaries() {
        for (FocusSessionKind location : LOCATIONS) {
            assertThat(CustomizationRewardDraw.probabilities(everyCategory, location, 1799).get("rare")).isZero();
            assertThat(CustomizationRewardDraw.probabilities(everyCategory, location, 1800).get("rare")).isPositive();
            assertThat(CustomizationRewardDraw.probabilities(everyCategory, location, 3599).get("legendary"))
                    .isZero();
            assertThat(CustomizationRewardDraw.probabilities(everyCategory, location, 3600).get("legendary"))
                    .isPositive();
        }
    }

    @Test
    @DisplayName("같은 시간이면 섬의 희귀+전설 확률이 바다보다 높다")
    void islandIsRicherThanSea() {
        for (long s = 1800; s <= 14_400; s += 300) {
            Map<String, Double> island =
                    CustomizationRewardDraw.probabilities(everyCategory, FocusSessionKind.ISLAND, s);
            Map<String, Double> sea = CustomizationRewardDraw.probabilities(everyCategory, FocusSessionKind.SEA, s);
            assertThat(island.get("rare") + island.get("legendary")).as("%d초", s)
                    .isGreaterThan(sea.get("rare") + sea.get("legendary"));
        }
    }

    @Test
    @DisplayName("같은 세션은 몇 번을 뽑아도 같은 아이템이고, 15분 미만이면 아무것도 뽑지 않는다")
    void sameSessionSameItemAndNothingUnderFifteenMinutes() {
        Random random = new Random(2301);
        for (int i = 0; i < 200; i++) {
            UUID session = new UUID(random.nextLong(), random.nextLong());
            CustomizationRewardItem first = pick(catOnly, allItems, FocusSessionKind.ISLAND, 3600, session);
            assertThat(pick(catOnly, allItems, FocusSessionKind.ISLAND, 3600, session)).isSameAs(first);
            assertThat(CustomizationRewardDraw.pick(catOnly, allItems, FocusSessionKind.ISLAND, 899, session))
                    .isEmpty();
            assertThat(CustomizationRewardDraw.pick(catOnly, allItems, FocusSessionKind.ISLAND, 900, session))
                    .isPresent();
        }
    }

    @Test
    @DisplayName("고정 세션 2만 개로 뽑으면 등급은 산식 확률, 카테고리는 머리·목이 반씩 나온다")
    void distributionFollowsTheFormula() {
        int draws = 20_000;
        Map<String, Integer> rarities = new HashMap<>();
        Map<String, Integer> categories = new HashMap<>();
        Random random = new Random(20_260_101L);
        for (int i = 0; i < draws; i++) {
            CustomizationRewardItem item = pick(catOnly, allItems, FocusSessionKind.ISLAND, 3600,
                    new UUID(random.nextLong(), random.nextLong()));
            rarities.merge(item.getRarity(), 1, Integer::sum);
            categories.merge(item.getCategory(), 1, Integer::sum);
        }
        Map<String, Double> expected = CustomizationRewardDraw.probabilities(catOnly, FocusSessionKind.ISLAND, 3600);
        expected.forEach((rarity, p) -> assertThat(rarities.getOrDefault(rarity, 0) / (double) draws).as(rarity)
                .isCloseTo(p, within(0.015)));
        assertThat(categories.keySet()).isEqualTo(CAT_CATEGORIES);
        categories.forEach((category, count) -> assertThat(count / (double) draws).as(category)
                .isCloseTo(1 / 2.0, within(0.015)));
    }

    @Test
    @DisplayName("머리·목 정책은 후보에 신발·뗏목 70종이 섞여 있어도 그것을 뽑지 않는다 — 9분류 정책은 뽑는다")
    void shoesAndRaftItemsAreNeverDrawnFromTheCatPolicy() {
        Random random = new Random(7);
        boolean excludedUnderEveryCategory = false;
        for (int i = 0; i < 3000; i++) {
            UUID session = new UUID(random.nextLong(), random.nextLong());
            for (FocusSessionKind location : LOCATIONS) {
                for (long seconds : new long[] {900, 2700, 7200}) {
                    assertThat(pick(catOnly, allItems, location, seconds, session).getCategory())
                            .isIn(CAT_CATEGORIES);
                    excludedUnderEveryCategory |= !CAT_CATEGORIES.contains(
                            pick(everyCategory, allItems, location, seconds, session).getCategory());
                }
            }
        }
        assertThat(excludedUnderEveryCategory).as("대조: 카테고리 가중치가 신발·뗏목을 빼는 유일한 장치다").isTrue();
    }

    @Test
    @DisplayName("후보가 한 줄뿐이면 확률이 있는 한 언제나 그 아이템이다 — 빈 칸은 남은 후보 안에서 정규화된다")
    void singleCandidateIsAlwaysDrawn() {
        CustomizationRewardItem only = allItems.stream()
                .filter(item -> item.getCategory().equals("head") && item.getRarity().equals("common"))
                .findFirst().orElseThrow();
        Random random = new Random(1);
        for (int i = 0; i < 500; i++) {
            assertThat(pick(catOnly, List.of(only), FocusSessionKind.SEA, 900,
                    new UUID(random.nextLong(), random.nextLong()))).isSameAs(only);
        }
    }

    @Test
    @DisplayName("카테고리 가중치 합이 0 이라 확률이 NaN 이 되면 후보 없음이다")
    void nanWeightsMeanNoCandidate() {
        Map<String, Object> zero = new HashMap<>(catOnly.getCategoryWeights());
        zero.replaceAll((category, weight) -> 0);
        CustomizationRewardPolicy broken = policy(policyJson, 3, catOnly.getLocationWeights(), zero);

        assertThat(CustomizationRewardDraw.pick(broken, allItems, FocusSessionKind.ISLAND, 3600, UUID.randomUUID()))
                .isEmpty();
    }

    @Test
    @DisplayName("가중치가 소수·문자열·음수이거나 등급 키가 빠지면 조용히 고치지 않고 IllegalArgumentException 이다")
    void nonIntegerWeightsAreRejected() {
        Map<String, Object> decimal = new HashMap<>(everyCategory.getLocationWeights());
        decimal.put("ISLAND", Map.of("common", 1.5, "uncommon", 30, "rare", 18, "legendary", 4));
        Map<String, Object> missingRare = new HashMap<>(everyCategory.getLocationWeights());
        missingRare.put("SEA", Map.of("common", 66, "uncommon", 26, "legendary", 1));
        Map<String, Object> text = new HashMap<>(catOnly.getCategoryWeights());
        text.put("head", "x");
        Map<String, Object> negative = new HashMap<>(catOnly.getCategoryWeights());
        negative.put("neck", -1);
        UUID session = UUID.randomUUID();

        assertThatThrownBy(() -> CustomizationRewardDraw.probabilities(
                policy(policyJson, 3, decimal, catOnly.getCategoryWeights()), FocusSessionKind.ISLAND, 900))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("ISLAND.common");
        assertThatThrownBy(() -> CustomizationRewardDraw.probabilities(
                policy(policyJson, 3, missingRare, catOnly.getCategoryWeights()), FocusSessionKind.SEA, 900))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("rare");
        assertThatThrownBy(() -> CustomizationRewardDraw.pick(
                policy(policyJson, 3, catOnly.getLocationWeights(), text), allItems, FocusSessionKind.SEA, 900,
                session)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("category_weights.head");
        assertThatThrownBy(() -> CustomizationRewardDraw.pick(
                policy(policyJson, 3, catOnly.getLocationWeights(), negative), allItems, FocusSessionKind.SEA, 900,
                session)).isInstanceOf(IllegalArgumentException.class);
    }

    private static CustomizationRewardItem pick(CustomizationRewardPolicy policy, List<CustomizationRewardItem> items,
                                                FocusSessionKind location, long seconds, UUID session) {
        return CustomizationRewardDraw.pick(policy, items, location, seconds, session).orElseThrow();
    }

    private static CustomizationRewardPolicy policy(JsonNode source, int revision,
                                                    Map<String, Object> locationWeights,
                                                    Map<String, Object> categoryWeights) {
        return CustomizationRewardPolicy.builder()
                .revision(revision)
                .minimumActiveSeconds(source.get("minimumActiveSeconds").asInt())
                .rareUnlockSeconds(source.get("rareUnlockSeconds").asInt())
                .legendaryUnlockSeconds(source.get("legendaryUnlockSeconds").asInt())
                .timeHalfSeconds(source.get("timeHalfSeconds").asInt())
                .rareMaxBonusPpm(source.get("rareMaxBonusPpm").asInt())
                .legendaryMaxBonusPpm(source.get("legendaryMaxBonusPpm").asInt())
                .locationWeights(locationWeights)
                .categoryWeights(categoryWeights)
                .build();
    }
}

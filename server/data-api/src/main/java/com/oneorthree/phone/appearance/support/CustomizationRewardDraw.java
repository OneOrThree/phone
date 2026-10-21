package com.oneorthree.phone.appearance.support;

import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardItem;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSessionKind;

import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 집중 꾸미기 보상 추첨 (GROMO-2301) — 등급 확률 산식과 세션 하나에 <b>고정된</b> 추첨. 순수 함수다.
 *
 * <h2>등급 확률</h2>
 * {@code server/scripts/customization/validate_reward_catalog.py} 의 {@code probabilities} 를 연산 순서까지 그대로
 * 옮겼다 — 같은 {@code probability-fixtures.json} 을 두 구현이 1e-12 로 맞춘다. 정책 표의 값만 쓰고 숫자를 박지 않는다.
 * 순서: 장소 기본 가중치를 확률로 → {@code factor = extra / (extra + timeHalf)}({@code extra = max(0, s - 최소)}) 만큼
 * 희귀·전설에 최대 가산(ppm)을 더하고 그만큼 일반에서 뺀다 → 해금 전 등급은 0 → 남은 몫을 일반·고급의 비율로 나눈다.
 *
 * <h2>아이템 하나 고르기</h2>
 * 아이템 확률은 {@code 카테고리 가중치 / 합 × 등급 확률 / 같은 카테고리·등급 아이템 수} 다. 정책에 없는 카테고리
 * (revision 2 의 신발·뗏목)는 0 이라 뽑히지 않는다. {@code sort_order, product_id} 순 누적합에서 {@code [0,1)} 난수 × 전체
 * 합이 처음 넘는 아이템이다 — 전체 합으로 곱하므로 비어 있는 (카테고리, 등급) 칸이 있어도 남은 후보 안에서 정규화된다.
 *
 * <h2>왜 난수 생성기가 아닌가</h2>
 * 같은 세션은 몇 번을 정산해도 같은 아이템이어야 한다 — 씨앗을 {@code (세션 id, revision)} 으로 고정하고
 * {@code focus/support/GoldenFishDraw} 와 같은 splitmix64 finalizer 로 섞는다. 중복 지급은 이 결정성이 아니라 정산 행
 * PK(세션당 한 번)와 보유 행 유일 인덱스(V64)가 막는다.
 *
 * <h2>정책 값 검증</h2>
 * 정책의 가중치는 JSON 그대로 들어온다. 0 이상의 정수가 아니거나 등급 키가 빠졌으면 {@link IllegalArgumentException} 이다 —
 * {@code 1.5} 를 1 로 버리는 식으로 조용히 고치지 않는다. 계산한 네 등급 확률도 유한한 0~1 이고 합이 1 이어야 한다 — 최대
 * 가산(ppm, DB 는 각각 100만까지 허용)이 기본 일반 확률보다 크면 일반이 음수가 되거나 희귀·전설이 1 을 넘는데, 이것을 아이템
 * 고르기의 재정규화로 덮으면 정책과 다른 분포로 지급된다. 호출자(정산)는 이 예외를 잡아 보상만 건너뛴다.
 */
public final class CustomizationRewardDraw {

    /** 등급 — 산식과 fixture 의 순서다. */
    public static final List<String> RARITIES = List.of("common", "uncommon", "rare", "legendary");

    private static final double PPM = 1_000_000.0;
    /** 등급 확률 합의 허용 오차 — 부동소수 끝자리만 받는다(fixture 일치는 1e-12). */
    private static final double PROBABILITY_SUM_TOLERANCE = 1e-9;
    private static final long GAMMA = 0x9E3779B97F4A7C15L;
    private static final long MIX_A = 0xBF58476D1CE4E5B9L;
    private static final long MIX_B = 0x94D049BB133111EBL;

    private CustomizationRewardDraw() {
    }

    /**
     * @return 등급 → 확률({@link #RARITIES} 순). 최소 시간 미만이면 전부 0, 이상이면 합이 1 이다
     * @throws IllegalArgumentException 가중치가 0 이상의 정수가 아니거나, 계산한 확률이 0~1 을 벗어나거나 합이 1 이 아닐 때
     */
    public static Map<String, Double> probabilities(CustomizationRewardPolicy policy, FocusSessionKind location,
                                                    long activeSeconds) {
        Map<String, Double> p = new LinkedHashMap<>();
        if (activeSeconds < policy.getMinimumActiveSeconds()) {
            RARITIES.forEach(rarity -> p.put(rarity, 0.0));
            return p;
        }
        Map<String, Integer> weights = weights(policy.getLocationWeights().get(location.name()),
                "location_weights." + location.name());
        for (String rarity : RARITIES) {
            if (!weights.containsKey(rarity)) {
                throw new IllegalArgumentException("location_weights." + location.name() + " 에 " + rarity + " 가 없다");
            }
        }
        double total = RARITIES.stream().mapToInt(weights::get).sum();
        double extra = Math.max(0L, activeSeconds - policy.getMinimumActiveSeconds());
        double factor = extra / (extra + policy.getTimeHalfSeconds());
        double rareBonus = policy.getRareMaxBonusPpm() / PPM * factor;
        double legendaryBonus = policy.getLegendaryMaxBonusPpm() / PPM * factor;
        double common = weights.get("common") / total - rareBonus - legendaryBonus;
        double uncommon = weights.get("uncommon") / total;
        double rare = activeSeconds >= policy.getRareUnlockSeconds() ? weights.get("rare") / total + rareBonus : 0.0;
        double legendary = activeSeconds >= policy.getLegendaryUnlockSeconds()
                ? weights.get("legendary") / total + legendaryBonus : 0.0;
        double remaining = 1 - rare - legendary;
        p.put("common", remaining * common / (common + uncommon));
        p.put("uncommon", remaining * uncommon / (common + uncommon));
        p.put("rare", rare);
        p.put("legendary", legendary);
        double sum = 0;
        for (Map.Entry<String, Double> entry : p.entrySet()) {
            double value = entry.getValue();
            if (!(value >= 0 && value <= 1)) {
                throw new IllegalArgumentException("등급 확률이 0~1 을 벗어난다 — revision=" + policy.getRevision() + ", "
                        + location + " " + activeSeconds + "초 " + entry.getKey() + "=" + value);
            }
            sum += value;
        }
        if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
            throw new IllegalArgumentException("등급 확률 합이 1 이 아니다 — revision=" + policy.getRevision() + ", "
                    + location + " " + activeSeconds + "초 합=" + sum);
        }
        return p;
    }

    /**
     * @param items 정책 revision 의 후보 전체 — 순서는 여기서 {@code sort_order, product_id} 로 맞춘다
     * @return 뽑힌 아이템. 최소 시간 미만이거나 확률이 있는 후보가 없으면(합이 0·NaN) 빈 값
     */
    public static Optional<CustomizationRewardItem> pick(CustomizationRewardPolicy policy,
                                                         List<CustomizationRewardItem> items,
                                                         FocusSessionKind location, long activeSeconds,
                                                         UUID sessionId) {
        Map<String, Double> grades = probabilities(policy, location, activeSeconds);
        Map<String, Integer> categoryWeights = weights(policy.getCategoryWeights(), "category_weights");
        double categoryTotal = categoryWeights.values().stream().mapToInt(Integer::intValue).sum();
        Map<String, Integer> counts = new HashMap<>();
        items.forEach(item -> counts.merge(item.getCategory() + "/" + item.getRarity(), 1, Integer::sum));
        List<CustomizationRewardItem> ordered = items.stream()
                .sorted(Comparator.comparingInt(CustomizationRewardItem::getSortOrder)
                        .thenComparing(CustomizationRewardItem::getProductId))
                .toList();
        double[] weights = new double[ordered.size()];
        double total = 0;
        for (int i = 0; i < ordered.size(); i++) {
            CustomizationRewardItem item = ordered.get(i);
            weights[i] = categoryWeights.getOrDefault(item.getCategory(), 0) / categoryTotal
                    * grades.getOrDefault(item.getRarity(), 0.0)
                    / counts.get(item.getCategory() + "/" + item.getRarity());
            total += weights[i];
        }
        // NaN(카테고리 가중치 합 0 등)도 «후보 없음» 이다 — NaN 은 어떤 비교도 거짓이라 <= 0 으로는 걸리지 않는다.
        if (!(total > 0)) {
            return Optional.empty();
        }
        double target = roll(sessionId, policy.getRevision()) * total;
        double cumulative = 0;
        CustomizationRewardItem last = null;
        for (int i = 0; i < ordered.size(); i++) {
            if (weights[i] <= 0) {
                continue;
            }
            cumulative += weights[i];
            last = ordered.get(i);
            if (target < cumulative) {
                return Optional.of(last);
            }
        }
        // 부동소수 합의 끝자리 오차로 마지막 후보까지 넘지 못한 경우 — 확률이 있는 마지막 후보다.
        return Optional.ofNullable(last);
    }

    /** JSON 객체 하나를 «키 → 0 이상의 정수» 로 읽는다 — 객체가 아니거나 정수가 아닌 값이 있으면 예외다. */
    private static Map<String, Integer> weights(Object json, String path) {
        if (!(json instanceof Map<?, ?> map)) {
            throw new IllegalArgumentException(path + " 가 객체가 아니다: " + json);
        }
        Map<String, Integer> result = new LinkedHashMap<>();
        map.forEach((key, value) -> {
            if (!(value instanceof Integer weight) || weight < 0) {
                throw new IllegalArgumentException(path + "." + key + " 는 0 이상의 정수여야 한다: " + value);
            }
            result.put(String.valueOf(key), weight);
        });
        return result;
    }

    /** {@code (세션, revision)} 에 고정된 {@code [0, 1)} 값 — GoldenFishDraw 와 같은 섞기, 상위 53비트를 쓴다. */
    private static double roll(UUID sessionId, int revision) {
        long z = sessionId.getMostSignificantBits() * MIX_A
                + sessionId.getLeastSignificantBits() * MIX_B
                + revision * GAMMA;
        z = (z ^ (z >>> 30)) * MIX_A;
        z = (z ^ (z >>> 27)) * MIX_B;
        z ^= z >>> 31;
        return (z >>> 11) * 0x1.0p-53;
    }
}

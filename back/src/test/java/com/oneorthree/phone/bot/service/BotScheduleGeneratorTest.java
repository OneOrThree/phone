package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.domain.BotChronotype;
import com.oneorthree.phone.bot.domain.BotFocusBlock;
import com.oneorthree.phone.bot.domain.BotProfile;
import com.oneorthree.phone.bot.domain.BotStyle;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 봇 스케줄 생성 규칙 고정 (GROMO-1565).
 *
 * <p>여기서 검증하는 불변식은 전부 <b>"사람처럼 보이는가"</b> 하나로 수렴한다. 어느 하나가 풀리면
 * 3시간 내리 앉아 있거나, 한 과목만 종일 붙잡거나, 새벽 4시에 시작해 다음날 오후까지 집중하는 봇이
 * 생긴다 — 전부 실제로 구현 중에 한 번씩 났던 증상이라 테스트로 못 박는다.
 *
 * <p>성향 × 스타일 × 티어별 목표의 모든 조합을 4주간 돌려 검사한다.
 */
class BotScheduleGeneratorTest {

    private static final LocalDate MONDAY = LocalDate.of(2026, 8, 10);
    private static final int WEEKS = 4;

    /** 티어별 (주간 목표 분, 활동일) — 실제 시드가 쓰는 구간의 대표값. */
    private static final int[][] TIER_TARGETS = {{540, 4}, {1260, 5}, {2100, 6}, {2880, 6}};

    private final BotScheduleGenerator generator = new BotScheduleGenerator();

    private static final List<UUID> TAGS = List.of(
            tagId("국어"), tagId("수학"), tagId("영어"), tagId("탐구"), tagId("모의고사"));

    private static UUID tagId(String name) {
        return UUID.nameUUIDFromBytes(name.getBytes(StandardCharsets.UTF_8));
    }

    /** 성향 × 스타일 × 티어 전 조합. 쉬는 요일은 활동일 수에 맞춰 흩어 놓는다. */
    private static List<BotProfile> allProfiles() {
        List<BotProfile> profiles = new ArrayList<>();
        int index = 0;
        for (BotChronotype chronotype : BotChronotype.values()) {
            for (BotStyle style : BotStyle.values()) {
                for (int[] target : TIER_TARGETS) {
                    int activeDays = target[1];
                    profiles.add(BotProfile.builder()
                            .userId(UUID.nameUUIDFromBytes(("bot-" + index++).getBytes(StandardCharsets.UTF_8)))
                            .chronotype(chronotype)
                            .style(style)
                            .weeklyMinutes(target[0])
                            .activeDays(activeDays)
                            .restDayMask(restMask(activeDays, index))
                            .build());
                }
            }
        }
        return profiles;
    }

    private static int restMask(int activeDays, int offset) {
        int mask = 0;
        for (int k = 0; k < 7 - activeDays; k++) {
            mask |= 1 << ((offset + k * 3) % 7);
        }
        return mask;
    }

    private List<BotFocusBlock> blocksOf(BotProfile profile, LocalDate date) {
        return generator.blocksOf(profile, date, TAGS);
    }

    @Test
    @DisplayName("어떤 봇도 한 번에 110분을 넘게 앉아 있지 않는다")
    void blockNeverExceedsMaxLength() {
        forEachDay((profile, date, blocks) -> {
            for (BotFocusBlock block : blocks) {
                assertThat(block.lengthMinutes())
                        .as("%s/%s 블록 길이", profile.getChronotype(), profile.getStyle())
                        .isLessThanOrEqualTo(BotStyle.MAX_BLOCK_MINUTES)
                        .isPositive();
            }
        });
    }

    @Test
    @DisplayName("블록은 시각 오름차순이고 서로 겹치지 않는다")
    void blocksAreOrderedAndDisjoint() {
        forEachDay((profile, date, blocks) -> {
            for (int i = 1; i < blocks.size(); i++) {
                assertThat(blocks.get(i).startMinute())
                        .as("%s 블록 겹침", profile.getUserId())
                        .isGreaterThan(blocks.get(i - 1).endMinute());
            }
        });
    }

    @Test
    @DisplayName("같은 과목을 3블록 연속으로 하지 않는다")
    void neverRepeatsSameSubjectThreeTimes() {
        forEachDay((profile, date, blocks) -> {
            for (int i = 2; i < blocks.size(); i++) {
                boolean threeInARow = blocks.get(i).focusTagId().equals(blocks.get(i - 1).focusTagId())
                        && blocks.get(i - 1).focusTagId().equals(blocks.get(i - 2).focusTagId());
                assertThat(threeInARow)
                        .as("%s %s 같은 과목 3연속", profile.getUserId(), date)
                        .isFalse();
            }
        });
    }

    @Test
    @DisplayName("성향마다 정해진 활동 창을 벗어나지 않는다")
    void staysWithinChronotypeWindow() {
        forEachDay((profile, date, blocks) -> {
            BotChronotype chronotype = profile.getChronotype();
            for (BotFocusBlock block : blocks) {
                assertThat(block.startMinute())
                        .as("%s 시작이 성향보다 이르다", chronotype)
                        .isGreaterThanOrEqualTo(chronotype.startMinute());
                assertThat(block.endMinute())
                        .as("%s 종료가 활동 창을 넘었다", chronotype)
                        .isLessThanOrEqualTo(chronotype.hardEndMinute());
            }
        });
    }

    @Test
    @DisplayName("쉬는 날과 과목이 없는 봇은 아무 블록도 만들지 않는다")
    void restDayAndTaglessBotProduceNothing() {
        BotProfile profile = allProfiles().get(0);
        LocalDate restDay = firstRestDay(profile);

        assertThat(blocksOf(profile, restDay)).isEmpty();
        assertThat(generator.blocksOf(profile, restDay.plusDays(1), List.of())).isEmpty();
    }

    @Test
    @DisplayName("같은 봇·같은 날짜는 몇 번을 계산해도 같은 스케줄이 나온다")
    void isDeterministic() {
        // 상태를 저장하지 않고 매 tick 재계산하는 설계라, 이게 깨지면 봇이 5분마다 세션을 열고 닫는다.
        for (BotProfile profile : allProfiles()) {
            for (int day = 0; day < 7; day++) {
                LocalDate date = MONDAY.plusDays(day);
                assertThat(blocksOf(profile, date)).isEqualTo(blocksOf(profile, date));
            }
        }
    }

    @Test
    @DisplayName("야간형은 자정을 넘겨 집중한다 — 새벽 tick 이 어제 스케줄을 봐야 하는 근거")
    void nightBotsCrossMidnight() {
        boolean crossedMidnight = allProfiles().stream()
                .filter(profile -> profile.getChronotype() == BotChronotype.NIGHT)
                .flatMap(profile -> everyDay(profile).stream())
                .anyMatch(block -> block.endMinute() > 24 * 60);

        assertThat(crossedMidnight).isTrue();
    }

    @Test
    @DisplayName("주간 집중 총량이 목표에서 크게 벗어나지 않는다")
    void weeklyTotalStaysNearTarget() {
        for (BotProfile profile : allProfiles()) {
            // 야간형은 창(20시~다음날 06시)이 좁아 고티어 목표를 채울 수 없다. 실제 시드가 야간형에
            // 고티어를 주지 않는 이유이며, 여기서는 검증 대상에서 뺀다.
            if (profile.getChronotype() == BotChronotype.NIGHT && profile.getWeeklyMinutes() > 1260) {
                continue;
            }
            int total = everyDay(profile).stream().mapToInt(BotFocusBlock::lengthMinutes).sum() / WEEKS;
            assertThat(total)
                    .as("%s/%s 주 %d분 목표", profile.getChronotype(), profile.getStyle(), profile.getWeeklyMinutes())
                    .isBetween((int) (profile.getWeeklyMinutes() * 0.55), (int) (profile.getWeeklyMinutes() * 1.15));
        }
    }

    private LocalDate firstRestDay(BotProfile profile) {
        for (int day = 0; day < 7; day++) {
            LocalDate date = MONDAY.plusDays(day);
            if (profile.restsOn(date.getDayOfWeek())) {
                return date;
            }
        }
        throw new IllegalStateException("쉬는 날이 없는 프로필");
    }

    private List<BotFocusBlock> everyDay(BotProfile profile) {
        List<BotFocusBlock> all = new ArrayList<>();
        for (int day = 0; day < 7 * WEEKS; day++) {
            all.addAll(blocksOf(profile, MONDAY.plusDays(day)));
        }
        return all;
    }

    private void forEachDay(DayCheck check) {
        for (BotProfile profile : allProfiles()) {
            for (int day = 0; day < 7 * WEEKS; day++) {
                LocalDate date = MONDAY.plusDays(day);
                check.accept(profile, date, blocksOf(profile, date));
            }
        }
    }

    @FunctionalInterface
    private interface DayCheck {
        void accept(BotProfile profile, LocalDate date, List<BotFocusBlock> blocks);
    }
}

package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.repository.domain.BotChronotype;
import com.oneorthree.phone.bot.support.BotFocusBlock;
import com.oneorthree.phone.bot.repository.domain.BotProfile;
import com.oneorthree.phone.bot.repository.domain.BotStyle;
import com.oneorthree.phone.bot.support.BotScheduleGenerator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * <b>실제 시드된 190명</b>으로 스케줄을 돌려 검증한다 (GROMO-1565).
 *
 * <p>{@code BotScheduleGeneratorTest} 는 성향 × 스타일 × 목표 조합을 임의 UUID 로 검사한다. 그것만으로는
 * 부족하다는 게 코드리뷰에서 드러났다 — 시드에 실제로 들어가는 UUID·목표 조합에서만 티어 유지가
 * 깨지거나, 190명을 한꺼번에 놓고 봐야 보이는 시간대 공백이 있었다. 그래서 여기서는 마이그레이션
 * SQL 을 그대로 파싱해 진짜 프로필로 돌린다.
 *
 * <p>봇 id 는 {@code md5('gromo-bot-' || nickname)::uuid} 로 정해지므로 SQL 없이 재현할 수 있다.
 * {@link UUID#nameUUIDFromBytes} 는 버전·변형 비트를 덮어써서 Postgres 의 {@code md5()::uuid} 와
 * 값이 달라지므로 쓰지 않는다.
 */
class BotSeedScheduleTest {

    private static final String MIGRATION = "/db/migration/V48__league_bots.sql";

    /**
     * 검사 기간. 주간 판정이라 주 경계(월요일)에서 시작한다.
     *
     * <p>1년을 보는 이유: 8주만 검사했더니 26주 뒤에 강등선을 밑도는 주가 남아 있었다(코드리뷰 반영).
     * 생성량은 주마다 흔들리므로 짧게 보면 꼬리를 놓친다.
     */
    private static final LocalDate FIRST_MONDAY = LocalDate.of(2026, 8, 10);
    private static final int WEEKS = 52;

    /** 과목 수는 난수 소비 횟수에 영향을 주지 않으므로(항상 2회) 더미로 충분하다. */
    private static final List<UUID> DUMMY_TAGS = List.of(
            new UUID(1, 1), new UUID(1, 2), new UUID(1, 3), new UUID(1, 4));

    private static final BotScheduleGenerator GENERATOR = new BotScheduleGenerator();

    private static List<SeededBot> bots;

    /** 시드 한 줄 — 마이그레이션의 users·bot_profiles VALUES 를 닉네임으로 맞춘 것. */
    private record SeededBot(String nickname, int tierLevel, BotProfile profile) {
    }

    @BeforeAll
    static void loadSeed() throws IOException {
        String sql = readMigration();
        Map<String, Integer> tierByNickname = parseTiers(sql);
        bots = parseProfiles(sql, tierByNickname);
        assertThat(bots).as("시드 파싱 결과").hasSize(190);
    }

    private static String readMigration() throws IOException {
        try (InputStream in = BotSeedScheduleTest.class.getResourceAsStream(MIGRATION)) {
            assertThat(in).as("마이그레이션 %s 를 클래스패스에서 찾지 못했다", MIGRATION).isNotNull();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** {@code INSERT INTO users … VALUES ('닉','OCCUPATION',티어)} 에서 닉네임→티어. */
    private static Map<String, Integer> parseTiers(String sql) {
        String block = sectionAfter(sql, "INSERT INTO users (id, is_guest, is_bot, nickname");
        Matcher matcher = Pattern.compile("\\('([^']+)', '([A-Z_]+)', (\\d+)\\)").matcher(block);
        Map<String, Integer> tiers = new HashMap<>();
        while (matcher.find()) {
            tiers.put(matcher.group(1), Integer.parseInt(matcher.group(3)));
        }
        return tiers;
    }

    /** {@code INSERT INTO bot_profiles … VALUES ('닉','CHRONO','STYLE',주간분,활동일,마스크)}. */
    private static List<SeededBot> parseProfiles(String sql, Map<String, Integer> tiers) {
        String block = sectionAfter(sql, "INSERT INTO bot_profiles (user_id, chronotype");
        Matcher matcher = Pattern
                .compile("\\('([^']+)', '([A-Z]+)', '([A-Z]+)', (\\d+), (\\d+), (\\d+)\\)")
                .matcher(block);
        List<SeededBot> parsed = new ArrayList<>();
        while (matcher.find()) {
            String nickname = matcher.group(1);
            parsed.add(new SeededBot(nickname, tiers.getOrDefault(nickname, 0), BotProfile.builder()
                    .userId(botIdOf(nickname))
                    .chronotype(BotChronotype.valueOf(matcher.group(2)))
                    .style(BotStyle.valueOf(matcher.group(3)))
                    .weeklyMinutes(Integer.parseInt(matcher.group(4)))
                    .activeDays(Integer.parseInt(matcher.group(5)))
                    .restDayMask(Integer.parseInt(matcher.group(6)))
                    .build()));
        }
        return parsed;
    }

    private static String sectionAfter(String sql, String marker) {
        int from = sql.indexOf(marker);
        assertThat(from).as("마이그레이션에서 '%s' 를 찾지 못했다", marker).isNotNegative();
        int to = sql.indexOf("ON CONFLICT", from);
        return sql.substring(from, to < 0 ? sql.length() : to);
    }

    /** {@code md5('gromo-bot-' || nickname)::uuid} 와 같은 값. */
    private static UUID botIdOf(String nickname) {
        try {
            byte[] digest = MessageDigest.getInstance("MD5")
                    .digest(("gromo-bot-" + nickname).getBytes(StandardCharsets.UTF_8));
            long high = 0;
            long low = 0;
            for (int i = 0; i < 8; i++) {
                high = (high << 8) | (digest[i] & 0xffL);
                low = (low << 8) | (digest[i + 8] & 0xffL);
            }
            return new UUID(high, low);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("MD5 를 쓸 수 없다", e);
        }
    }

    /** 티어별 유지 구간(분) — {@code V13__league_tier_thresholds.sql} 의 강등·승급 임계값. */
    private static int[] keepRange(int tierLevel) {
        return new int[][]{{0, 14 * 60}, {14 * 60, 28 * 60}, {28 * 60, 42 * 60}, {42 * 60, 56 * 60}}
                [tierLevel - 1];
    }

    @Test
    @DisplayName("시드된 190명 전원이 어느 주에도 자기 티어 유지 구간을 벗어나지 않는다")
    void everySeededBotKeepsItsTierEveryWeek() {
        for (SeededBot bot : bots) {
            int[] range = keepRange(bot.tierLevel());
            for (int week = 0; week < WEEKS; week++) {
                int total = 0;
                for (int day = 0; day < 7; day++) {
                    total += GENERATOR
                            .blocksOf(bot.profile(), FIRST_MONDAY.plusDays(week * 7L + day), DUMMY_TAGS)
                            .stream().mapToInt(BotFocusBlock::lengthMinutes).sum();
                }
                assertThat(total)
                        .as("%s (T%d, %s/%s, 목표 %d분) — %d주차",
                                bot.nickname(), bot.tierLevel(), bot.profile().getChronotype(),
                                bot.profile().getStyle(), bot.profile().getWeeklyMinutes(), week + 1)
                        .isGreaterThanOrEqualTo(range[0])
                        .isLessThan(range[1]);
            }
        }
    }

    /**
     * 커버리지도 같은 1년을 본다. 8주만 검사했더니 29주차(2027-03-06 18:05)에 공백이 남아 있었다
     * (코드리뷰 반영). 분 단위 배열이 1년치면 2MB 남짓이라 감당할 만하다.
     */
    private static final int COVERAGE_WEEKS = WEEKS;

    @Test
    @DisplayName("24시간 어느 순간에도 집중 중인 봇이 최소 한 명은 있다")
    void someoneIsAlwaysFocusing() {
        // 콜드스타트의 핵심 전제다. 봇마다 독립적으로 스케줄을 뽑으므로 전체를 겹쳐 보지 않으면
        // 새벽처럼 활동이 옅은 시간대에 아무도 없는 구간이 생긴다(코드리뷰 반영).
        int days = COVERAGE_WEEKS * 7;
        int[] focusingAt = new int[(days + 2) * 24 * 60];

        for (SeededBot bot : bots) {
            for (int day = 0; day < days; day++) {
                int dayOffset = day * 24 * 60;
                for (BotFocusBlock block : GENERATOR.blocksOf(
                        bot.profile(), FIRST_MONDAY.plusDays(day), DUMMY_TAGS)) {
                    // 자정을 넘긴 블록은 그대로 다음날 구간에 얹힌다.
                    for (int minute = block.startMinute(); minute < block.endMinute(); minute++) {
                        focusingAt[dayOffset + minute]++;
                    }
                }
            }
        }

        // 첫날·마지막날은 앞뒤 스케줄이 없어 경계가 부정확하므로 안쪽만 본다.
        int from = 24 * 60;
        int to = (days - 1) * 24 * 60;
        int emptyMinutes = 0;
        int worstMinute = -1;
        for (int minute = from; minute < to; minute++) {
            if (focusingAt[minute] == 0) {
                emptyMinutes++;
                if (worstMinute < 0) {
                    worstMinute = minute;
                }
            }
        }

        assertThat(emptyMinutes)
                .as("아무도 집중하지 않는 시간이 %d분 있다 (처음 발생: %s %02d:%02d KST)",
                        emptyMinutes,
                        worstMinute < 0 ? "-" : FIRST_MONDAY.plusDays(worstMinute / (24 * 60)).toString(),
                        worstMinute < 0 ? 0 : (worstMinute % (24 * 60)) / 60,
                        worstMinute < 0 ? 0 : worstMinute % 60)
                .isZero();
    }
}

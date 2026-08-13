package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.domain.BotChronotype;
import com.oneorthree.phone.bot.domain.BotFocusBlock;
import com.oneorthree.phone.bot.domain.BotProfile;
import com.oneorthree.phone.bot.domain.BotStyle;
import com.oneorthree.phone.bot.repository.BotProfileRepository;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 봇 tick 이 실제로 집중 세션을 열고 닫는지 확인한다 (GROMO-1565).
 *
 * <p>스케줄 계산이 맞는지는 {@code BotScheduleGeneratorTest} 가 본다. 여기서 고정하는 건
 * <b>계산 결과가 FocusService 를 통해 실제 세션이 되는지</b>, 그리고 <b>자정을 넘긴 야간형 봇이
 * 새벽 tick 에서 사라지지 않는지</b>다. 후자는 구현 중 실제로 놓쳤던 지점이라 회귀 방지가 필요하다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@code BotSimulator} 가 봇마다 별도 트랜잭션
 * ({@code FocusService})을 열기 때문이다 — 테스트 트랜잭션에 묶으면 실제 커밋 경계를 재현하지 못한다.
 */
class BotSimulatorIntegrationTest extends IntegrationTestBase {

    @Autowired
    private BotSimulator botSimulator;
    @Autowired
    private BotScheduleGenerator scheduleGenerator;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private UserWalletRepository userWalletRepository;
    @Autowired
    private BotProfileRepository botProfileRepository;
    @Autowired
    private DefaultTagRepository defaultTagRepository;
    @Autowired
    private UserFocusTagRepository userFocusTagRepository;
    @Autowired
    private FocusSessionRepository focusSessionRepository;
    @Autowired
    private DailyFocusStatRepository dailyFocusStatRepository;

    private User bot;

    @AfterEach
    void cleanUp() {
        if (bot == null) {
            return;
        }
        focusSessionRepository.deleteAll(focusSessionRepository.findAll().stream()
                .filter(session -> session.getUser() != null && session.getUser().getId().equals(bot.getId()))
                .toList());
        dailyFocusStatRepository.deleteAll(dailyFocusStatRepository.findAll().stream()
                .filter(stat -> stat.getUser() != null && stat.getUser().getId().equals(bot.getId()))
                .toList());
        userFocusTagRepository.deleteAll(userFocusTagRepository.findActiveByUserIdIn(List.of(bot.getId())));
        botProfileRepository.deleteById(bot.getId());
        userWalletRepository.deleteById(bot.getId());
        userRepository.deleteById(bot.getId());
        bot = null;
    }

    /**
     * 봇 하나를 만든다. 닉네임·태그명은 실행마다 유일해야 한다 — 하드코딩하면 다른 테스트와
     * 유니크 제약으로 충돌한다(GROMO-1512).
     */
    private List<UUID> createBot(BotChronotype chronotype, int restDayMask) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        bot = userRepository.save(User.builder()
                .nickname("봇테스트-" + suffix)
                .isBot(true)
                .build());
        userWalletRepository.save(UserWallet.builder().userId(bot.getId()).balance(0).build());
        botProfileRepository.save(BotProfile.builder()
                .userId(bot.getId())
                .chronotype(chronotype)
                .style(BotStyle.POMODORO)
                .weeklyMinutes(1260)
                .activeDays(7 - Integer.bitCount(restDayMask))
                .restDayMask(restDayMask)
                .build());

        return List.of("이론-" + suffix, "문제-" + suffix, "복습-" + suffix).stream()
                .map(name -> {
                    DefaultTag tag = defaultTagRepository.save(DefaultTag.builder().name(name).build());
                    return userFocusTagRepository.save(
                            UserFocusTag.builder().user(bot).defaultTag(tag).build()).getId();
                })
                .toList();
    }

    private static Instant kstInstant(LocalDate date, int minuteOfDay) {
        return date.atStartOfDay(ZonePolicy.KST).plusMinutes(minuteOfDay).toInstant();
    }

    private long liveSessionCount() {
        return focusSessionRepository
                .findLiveSessionsByUserIdIn(List.of(bot.getId()), Instant.now().minus(Duration.ofHours(12)))
                .size();
    }

    @Test
    @DisplayName("블록 안에서는 세션이 열리고, 블록이 끝나면 닫힌다 — 같은 상태의 tick 은 아무것도 하지 않는다")
    void opensAndClosesSessionAcrossBlockBoundary() {
        // 쉬는 날 없이(마스크 0) 만들어 어느 날짜를 잡아도 블록이 나오게 한다.
        List<UUID> tagIds = createBot(BotChronotype.DAWN, 0);
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        List<BotFocusBlock> blocks = scheduleGenerator.blocksOf(readProfile(), today, tagIds);
        assertThat(blocks).as("테스트 전제 — 오늘 블록이 있어야 한다").isNotEmpty();

        BotFocusBlock first = blocks.get(0);
        int insideBlock = first.startMinute() + first.lengthMinutes() / 2;
        // 블록 사이 휴식은 최소 10분이라 종료 1분 뒤는 확실히 블록 밖이다.
        int afterBlock = first.endMinute() + 1;

        BotSimulator.BotTickResult opened = botSimulator.tick(kstInstant(today, insideBlock));
        assertThat(opened.started()).isEqualTo(1);
        assertThat(opened.failed()).isZero();
        assertThat(liveSessionCount()).isEqualTo(1);

        // 같은 시각으로 한 번 더 — 이미 열려 있으므로 전이가 없어야 한다(5분마다 여닫으면 안 된다).
        assertThat(botSimulator.tick(kstInstant(today, insideBlock)).isQuiet()).isTrue();

        BotSimulator.BotTickResult closed = botSimulator.tick(kstInstant(today, afterBlock));
        assertThat(closed.ended()).isEqualTo(1);
        assertThat(closed.failed()).isZero();
        assertThat(liveSessionCount()).isZero();
    }

    @Test
    @DisplayName("자정을 넘긴 야간형 봇은 새벽 tick 에서도 집중 중으로 남는다")
    void keepsNightBotFocusingAfterMidnight() {
        List<UUID> tagIds = createBot(BotChronotype.NIGHT, 0);
        BotProfile profile = readProfile();

        // 어제 블록이 자정을 넘는 날짜를 찾는다 — 그 다음날 새벽이 판정 대상이다.
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        BotFocusBlock crossing = null;
        LocalDate yesterday = null;
        for (int back = 1; back <= 14 && crossing == null; back++) {
            yesterday = today.minusDays(back);
            crossing = scheduleGenerator.blocksOf(profile, yesterday, tagIds).stream()
                    .filter(block -> block.endMinute() > 24 * 60)
                    .findFirst()
                    .orElse(null);
        }
        assertThat(crossing).as("테스트 전제 — 자정을 넘는 야간 블록이 있어야 한다").isNotNull();

        // 자정 이후 구간의 한가운데 = 어제 기준 분에서 1440 을 뺀 값이 그 다음날의 시각이다.
        int minuteAfterMidnight = (Math.max(crossing.startMinute(), 24 * 60) + crossing.endMinute()) / 2 - 24 * 60;
        Instant dawnTick = kstInstant(yesterday.plusDays(1), minuteAfterMidnight);

        BotSimulator.BotTickResult result = botSimulator.tick(dawnTick);

        // 어제 스케줄을 보지 않으면 이 봇은 새벽에 아무 블록에도 속하지 않아 세션이 열리지 않는다.
        assertThat(result.started()).isEqualTo(1);
        assertThat(liveSessionCount()).isEqualTo(1);
    }

    private BotProfile readProfile() {
        return botProfileRepository.findById(bot.getId()).orElseThrow();
    }
}

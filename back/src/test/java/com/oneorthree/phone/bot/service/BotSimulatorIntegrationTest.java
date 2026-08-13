package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.domain.BotChronotype;
import com.oneorthree.phone.bot.domain.BotFocusBlock;
import com.oneorthree.phone.bot.domain.BotProfile;
import com.oneorthree.phone.bot.domain.BotStyle;
import com.oneorthree.phone.bot.repository.BotProfileRepository;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 봇 tick 이 실제로 집중 세션을 열고 닫는지 확인한다 (GROMO-1565).
 *
 * <p>스케줄 계산이 맞는지는 {@code BotScheduleGeneratorTest} 가 본다. 여기서 고정하는 건 <b>계산
 * 결과가 FocusService 를 통해 실제 세션이 되는지</b>, 그리고 구현 중 실제로 놓쳤거나 코드리뷰에서
 * 지적된 두 경로다 — 자정을 넘긴 야간형 봇이 새벽에 사라지지 않는 것, tick 을 놓쳤다가 다음 블록에서
 * 복구될 때 이전 세션이 열린 채 남지 않는 것.
 *
 * <p>기존 라이브 세션이 필요한 검증은 {@code tick} 으로 만들지 않고 리포지토리로 직접 넣는다.
 * {@code FocusService} 는 시작 시각을 {@code [now-5분, now]} 로 클램프하므로, 과거 시각을 주입한
 * tick 으로 연 세션은 실제 현재 시각을 갖게 되어 블록과 어긋난다 — 테스트가 의도한 상태를 재현하지 못한다.
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
    @Autowired
    private CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    private UserStreakRepository userStreakRepository;

    private User bot;
    private List<UserFocusTag> tags;

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
        // 세션 종료가 FocusService 의 정상 경로를 타므로 코인 원장·스트릭까지 생긴다.
        // 유저보다 먼저 지우지 않으면 FK 위반으로 정리가 실패한다(GROMO-1512 와 같은 유형).
        currencyTransactionRepository.deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(bot));
        userStreakRepository.findByUser(bot).ifPresent(userStreakRepository::delete);
        userFocusTagRepository.deleteAll(tags);
        botProfileRepository.deleteById(bot.getId());
        userWalletRepository.deleteById(bot.getId());
        userRepository.deleteById(bot.getId());
        bot = null;
    }

    /**
     * 봇 하나를 만든다. 닉네임·태그명은 실행마다 유일해야 한다 — 하드코딩하면 다른 테스트와
     * 유니크 제약으로 충돌한다(GROMO-1512).
     */
    private void createBot(BotChronotype chronotype) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        bot = userRepository.save(User.builder()
                .nickname("봇테스트-" + suffix)
                .isBot(true)
                .build());
        userWalletRepository.save(UserWallet.builder().userId(bot.getId()).balance(0).build());
        // 쉬는 날 없이(마스크 0) 만들어 어느 날짜를 잡아도 블록이 나오게 한다.
        botProfileRepository.save(BotProfile.builder()
                .userId(bot.getId())
                .chronotype(chronotype)
                .style(BotStyle.POMODORO)
                .weeklyMinutes(1260)
                .activeDays(7)
                .restDayMask(0)
                .build());

        tags = new ArrayList<>();
        for (String name : List.of("이론-" + suffix, "문제-" + suffix, "복습-" + suffix)) {
            DefaultTag defaultTag = defaultTagRepository.save(DefaultTag.builder().name(name).build());
            tags.add(userFocusTagRepository.save(
                    UserFocusTag.builder().user(bot).defaultTag(defaultTag).build()));
        }
    }

    private List<UUID> tagIds() {
        return tags.stream().map(UserFocusTag::getId).toList();
    }

    private List<BotFocusBlock> blocksOn(LocalDate date) {
        return scheduleGenerator.blocksOf(
                botProfileRepository.findById(bot.getId()).orElseThrow(), date, tagIds());
    }

    private static Instant kstInstant(LocalDate date, int minuteOfDay) {
        return date.atStartOfDay(ZonePolicy.KST).plusMinutes(minuteOfDay).toInstant();
    }

    /** 라이브 세션을 원하는 시각으로 직접 열어 둔다 (FocusService 클램프를 우회). */
    private FocusSession openLiveSessionAt(Instant startedAt) {
        return focusSessionRepository.save(FocusSession.builder()
                .user(bot)
                .focusTag(tags.get(0))
                .startedAt(startedAt)
                .build());
    }

    private List<FocusSession> liveSessions() {
        return focusSessionRepository
                .findLiveSessionsByUserIdIn(List.of(bot.getId()), Instant.now().minus(Duration.ofHours(12)));
    }

    private static int middleOf(BotFocusBlock block) {
        return block.startMinute() + block.lengthMinutes() / 2;
    }

    @Test
    @DisplayName("블록 안에서 tick 하면 세션이 열린다")
    void opensSessionInsideBlock() {
        createBot(BotChronotype.DAWN);
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        List<BotFocusBlock> blocks = blocksOn(today);
        assertThat(blocks).as("테스트 전제 — 오늘 블록이 있어야 한다").isNotEmpty();

        BotSimulator.BotTickResult result = botSimulator.tick(kstInstant(today, middleOf(blocks.get(0))));

        assertThat(result.started()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(liveSessions()).hasSize(1);
    }

    @Test
    @DisplayName("이미 그 블록에서 집중 중이면 tick 은 아무것도 하지 않는다")
    void staysQuietWhileInsideSameBlock() {
        // 5분마다 세션을 여닫으면 집중 기록이 조각나고 라이브 표시도 깜빡인다.
        createBot(BotChronotype.DAWN);
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        BotFocusBlock block = blocksOn(today).get(0);
        openLiveSessionAt(kstInstant(today, block.startMinute()));

        BotSimulator.BotTickResult result = botSimulator.tick(kstInstant(today, middleOf(block)));

        assertThat(result.isQuiet()).isTrue();
        assertThat(liveSessions()).hasSize(1);
    }

    @Test
    @DisplayName("블록이 끝나면 세션을 닫는다")
    void closesSessionAfterBlockEnds() {
        createBot(BotChronotype.DAWN);
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        BotFocusBlock block = blocksOn(today).get(0);
        openLiveSessionAt(kstInstant(today, block.startMinute()));

        // 블록 사이 휴식은 최소 10분이라 종료 1분 뒤는 확실히 블록 밖이다.
        BotSimulator.BotTickResult result = botSimulator.tick(kstInstant(today, block.endMinute() + 1));

        assertThat(result.ended()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(liveSessions()).isEmpty();
    }

    @Test
    @DisplayName("휴식 구간 tick 을 놓치고 다음 블록에서 복구되면 이전 세션을 닫고 새로 연다")
    void replacesStaleSessionWhenNextBlockAlreadyStarted() {
        // 배포·DB 장애로 tick 을 몇 번 놓친 상황. 그냥 두면 이전 블록 세션이 계속 열린 채 남아
        // 종료 시 휴식·장애 시간까지 집중으로 적립되고 태그도 이전 과목으로 남는다(코드리뷰 반영).
        createBot(BotChronotype.DAWN);
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        List<BotFocusBlock> blocks = blocksOn(today);
        assertThat(blocks).as("테스트 전제 — 블록이 둘 이상 있어야 한다").hasSizeGreaterThan(1);

        UUID staleSessionId = openLiveSessionAt(kstInstant(today, blocks.get(0).startMinute())).getId();

        BotSimulator.BotTickResult result = botSimulator.tick(kstInstant(today, middleOf(blocks.get(1))));

        assertThat(result.replaced()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(liveSessions()).hasSize(1);
        assertThat(liveSessions().get(0).getId()).isNotEqualTo(staleSessionId);
    }

    @Test
    @DisplayName("자정을 넘긴 야간형 봇은 새벽 tick 에서도 집중 중으로 남는다")
    void keepsNightBotFocusingAfterMidnight() {
        createBot(BotChronotype.NIGHT);

        // 어제 블록이 자정을 넘는 날짜를 찾는다 — 그 다음날 새벽이 판정 대상이다.
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        BotFocusBlock crossing = null;
        LocalDate yesterday = null;
        for (int back = 1; back <= 14 && crossing == null; back++) {
            yesterday = today.minusDays(back);
            crossing = blocksOn(yesterday).stream()
                    .filter(block -> block.endMinute() > 24 * 60)
                    .findFirst()
                    .orElse(null);
        }
        assertThat(crossing).as("테스트 전제 — 자정을 넘는 야간 블록이 있어야 한다").isNotNull();

        // 자정 이후 구간의 한가운데 = 어제 기준 분에서 1440 을 뺀 값이 그 다음날의 시각이다.
        int minuteAfterMidnight = (Math.max(crossing.startMinute(), 24 * 60) + crossing.endMinute()) / 2 - 24 * 60;

        // 어제 스케줄을 보지 않으면 이 봇은 새벽에 아무 블록에도 속하지 않아 세션이 열리지 않는다.
        BotSimulator.BotTickResult result =
                botSimulator.tick(kstInstant(yesterday.plusDays(1), minuteAfterMidnight));

        assertThat(result.started()).isEqualTo(1);
        assertThat(liveSessions()).hasSize(1);
    }
}

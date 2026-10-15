package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.repository.domain.BotChronotype;
import com.oneorthree.phone.bot.support.BotFocusBlock;
import com.oneorthree.phone.bot.repository.domain.BotProfile;
import com.oneorthree.phone.bot.repository.domain.BotStyle;
import com.oneorthree.phone.bot.repository.BotProfileRepository;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.focus.repository.UserStreakRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.bot.support.BotScheduleGenerator;
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
 * <p>스케줄 계산이 맞는지는 {@code BotScheduleGeneratorTest}(규칙)와 {@code BotSeedScheduleTest}
 * (실제 시드)가 본다. 여기서 고정하는 건 <b>계산 결과가 FocusService 를 통해 실제 세션이 되는지</b>,
 * 그리고 코드리뷰에서 지적된 두 경로다 — 자정을 넘긴 야간형 봇이 새벽에 사라지지 않는 것, tick 을
 * 놓쳤다가 다음 블록에서 복구될 때 이전 세션이 열린 채 남지 않는 것.
 *
 * <p><b>시각 축을 하나로 맞춘다.</b> 기존 라이브 세션이 필요한 검증은 리포지토리로 직접 넣는데,
 * 그 시각이 미래면 {@code FocusService.endFocusSession} 이 종료 시각으로 실제 {@code Instant.now()}
 * 를 쓰는 탓에 {@code endedAt < startedAt} 이 되어 터지고, 반대로 먼 과거면 라이브 조회의 12시간
 * 하한 밖으로 나가 아예 잡히지 않는다(둘 다 코드리뷰에서 나온 실패다). 그래서 <b>지금 이 순간이
 * 블록 안에 오는 프로필</b>을 골라 잡고, 모든 시각을 그 블록 기준으로 계산한다.
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
     * 봇 하나와 과목 3개를 만든다. 닉네임·태그명은 실행마다 유일해야 한다 — 하드코딩하면 다른
     * 테스트와 유니크 제약으로 충돌한다(GROMO-1512).
     */
    private void createBot(BotChronotype chronotype) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        bot = userRepository.save(User.builder()
                .nickname("봇테스트-" + suffix)
                .isBot(true)
                .build());
        userWalletRepository.save(UserWallet.builder().userId(bot.getId()).balance(0).build());
        saveProfile(chronotype, BotStyle.POMODORO, 1400);

        tags = new ArrayList<>();
        for (String name : List.of("이론-" + suffix, "문제-" + suffix, "복습-" + suffix)) {
            DefaultTag defaultTag = defaultTagRepository.save(DefaultTag.builder().name(name).build());
            tags.add(userFocusTagRepository.save(
                UserFocusTag.builder().user(bot).defaultTag(defaultTag).build()));
        }
    }

    /** 쉬는 날 없이(마스크 0) 저장한다 — 어느 날짜를 잡아도 블록이 나오게 한다. */
    private BotProfile saveProfile(BotChronotype chronotype, BotStyle style, int weeklyMinutes) {
        return botProfileRepository.save(BotProfile.builder()
                .userId(bot.getId())
                .chronotype(chronotype)
                .style(style)
                .weeklyMinutes(weeklyMinutes)
                .activeDays(7)
                .restDayMask(0)
                .build());
    }

    /**
     * tick 시각으로 쓸 수 있는 블록을 골라 프로필을 저장하고, 그날 블록 목록과 그중 몇 번째인지를
     * 돌려준다. 성향·스타일·목표를 훑어 첫 조합을 채택한다.
     *
     * <p><b>"지금을 포함하는 블록"이 아니라 "최근 과거 블록"을 찾는다.</b> 시각 축 제약(클래스 주석)의
     * 실제 요구는 두 가지뿐이다 — tick 시각이 미래가 아닐 것, 라이브 세션 시작이 12시간 하한 안에 있을 것.
     * 종전처럼 현재 분을 포함하는 블록만 찾으면 <b>00~03시(KST)엔 후보가 아예 없다</b>(가장 이른 성향인
     * DAWN 이 03시 시작이라 그 시각 오늘 스케줄은 전부 미래다). 그 밖의 시각도 블록 사이 휴식에 걸리면
     * 못 찾는데, 블록 위상이 봇 userId 로 시드되는 탓에 통과 여부가 uuid 운이었다
     * (2026-08-13 CI 실패 — 02시대엔 4건 전부, 03시대엔 2건이 깨졌다).
     *
     * @param needsPreviousBlock 앞 블록이 있는 조합만 채택할지 (세션 교체 검증용)
     */
    private FocusingNow makeBotFocusingNow(boolean needsPreviousBlock) {
        Instant now = Instant.now();
        // 12시간 하한에 1시간 여유를 둔다 — 테스트가 도는 사이 하한이 블록을 지나쳐 버리지 않게.
        Instant earliest = now.minus(Duration.ofHours(11));
        LocalDate today = LocalDate.now(ZonePolicy.KST);

        // 오늘 스케줄이 아직 시작 전인 새벽에는 어제 스케줄에서 고른다(BotSimulator 도 어제 블록을 본다).
        for (LocalDate day : List.of(today, today.minusDays(1))) {
            for (BotChronotype chronotype : BotChronotype.values()) {
                for (BotStyle style : BotStyle.values()) {
                    for (int weeklyMinutes : new int[]{2800, 2100, 1400, 700}) {
                        BotProfile candidate = saveProfile(chronotype, style, weeklyMinutes);
                        List<BotFocusBlock> blocks = scheduleGenerator.blocksOf(candidate, day, tagIds());
                        for (int i = needsPreviousBlock ? 1 : 0; i < blocks.size(); i++) {
                            // 라이브 세션을 직접 열 시각 — 교체 검증이면 앞 블록 시작이 하한 안에 들어야 한다.
                            int liveStartMinute = blocks.get(needsPreviousBlock ? i - 1 : i).startMinute();
                            // 블록이 통째로 과거여야 tick·종료 시각이 미래로 새지 않는다(종료는 실제 now 를 쓴다).
                            boolean settled = kstInstant(day, blocks.get(i).endMinute() + 1).isBefore(now);
                            if (settled && !kstInstant(day, liveStartMinute).isBefore(earliest)) {
                                return new FocusingNow(day, blocks, i);
                            }
                        }
                    }
                }
            }
        }
        throw new IllegalStateException(
                "최근 12시간 안에서 끝난 블록 조합을 찾지 못했다 (now=" + now + ")");
    }

    private record FocusingNow(LocalDate day, List<BotFocusBlock> blocks, int index) {

        BotFocusBlock current() {
            return blocks.get(index);
        }

        BotFocusBlock previous() {
            return blocks.get(index - 1);
        }
    }

    private List<UUID> tagIds() {
        return tags.stream().map(UserFocusTag::getId).toList();
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
        FocusingNow now = makeBotFocusingNow(false);

        BotSimulator.BotTickResult result =
                botSimulator.tick(kstInstant(now.day(), middleOf(now.current())));

        assertThat(result.started()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(liveSessions()).hasSize(1);
    }

    @Test
    @DisplayName("이미 그 블록에서 집중 중이면 tick 은 아무것도 하지 않는다")
    void staysQuietWhileInsideSameBlock() {
        // 5분마다 세션을 여닫으면 집중 기록이 조각나고 라이브 표시도 깜빡인다.
        createBot(BotChronotype.DAWN);
        FocusingNow now = makeBotFocusingNow(false);
        openLiveSessionAt(kstInstant(now.day(), now.current().startMinute()));

        BotSimulator.BotTickResult result =
                botSimulator.tick(kstInstant(now.day(), middleOf(now.current())));

        assertThat(result.isQuiet()).isTrue();
        assertThat(liveSessions()).hasSize(1);
    }

    @Test
    @DisplayName("블록이 끝나면 세션을 닫는다")
    void closesSessionAfterBlockEnds() {
        createBot(BotChronotype.DAWN);
        FocusingNow now = makeBotFocusingNow(false);
        openLiveSessionAt(kstInstant(now.day(), now.current().startMinute()));

        // 블록 사이 휴식은 최소 10분이라 종료 1분 뒤는 확실히 블록 밖이다.
        BotSimulator.BotTickResult result =
                botSimulator.tick(kstInstant(now.day(), now.current().endMinute() + 1));

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
        FocusingNow now = makeBotFocusingNow(true);
        UUID staleSessionId =
                openLiveSessionAt(kstInstant(now.day(), now.previous().startMinute())).getId();

        BotSimulator.BotTickResult result =
                botSimulator.tick(kstInstant(now.day(), middleOf(now.current())));

        assertThat(result.replaced()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(liveSessions()).hasSize(1);
        assertThat(liveSessions().get(0).getId()).isNotEqualTo(staleSessionId);
    }

    @Test
    @DisplayName("자정을 넘긴 야간형 봇은 새벽 tick 에서도 집중 중으로 남는다")
    void keepsNightBotFocusingAfterMidnight() {
        // 여기서는 기존 라이브 세션이 필요 없어(새로 여는 것만 본다) 과거 날짜를 그대로 쓸 수 있다.
        createBot(BotChronotype.NIGHT);
        BotProfile profile = botProfileRepository.findById(bot.getId()).orElseThrow();

        LocalDate today = LocalDate.now(ZonePolicy.KST);
        BotFocusBlock crossing = null;
        LocalDate yesterday = null;
        for (int back = 1; back <= 14 && crossing == null; back++) {
            yesterday = today.minusDays(back);
            crossing = scheduleGenerator.blocksOf(profile, yesterday, tagIds()).stream()
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

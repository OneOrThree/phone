package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.domain.BotChronotype;
import com.oneorthree.phone.bot.domain.BotFocusBlock;
import com.oneorthree.phone.bot.domain.BotProfile;
import com.oneorthree.phone.bot.domain.BotStyle;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;

/**
 * 봇 한 명의 하루 집중 블록을 만든다 (GROMO-1565).
 *
 * <p><b>상태를 저장하지 않는다.</b> {@code (userId, 날짜)} 로 시드를 고정해 매 tick 같은 결과를 다시
 * 계산한다 — "이 봇이 지금 몇 번째 블록인지"를 어딘가에 적어두면 그게 전부 정합성 관리 부담이 된다.
 * 지금 집중 중인지 여부는 {@code focus_sessions} 가 이미 들고 있으므로 별도 상태가 필요 없다.
 *
 * <p>난수는 {@link Random} 을 시드로 초기화해 <b>순차 소비</b>한다. 같은 입력이면 같은 분기를 타므로
 * 소비 순서가 어긋나지 않는다. 보안 용도가 아니라 재현성이 목적이라 {@code SecureRandom} 을 쓰지 않는다.
 *
 * <p>사람처럼 보이게 하는 제약은 아래와 같고, 하나라도 풀리면 봇 티가 난다.
 * <ul>
 *   <li>블록은 {@link BotStyle#MAX_BLOCK_MINUTES} 를 넘지 않는다 — 3시간 연속 집중은 사람이 안 한다</li>
 *   <li>같은 과목은 최대 2블록 연속, 그 다음은 강제 전환</li>
 *   <li>시작 시각이 날마다 최대 3시간 흔들린다</li>
 *   <li>2~3블록마다, 그리고 식사 시간대에 크게 쉰다 — 하루가 오전/오후/저녁 덩어리로 갈라진다</li>
 * </ul>
 */
@Component
public class BotScheduleGenerator {

    /**
     * 하루 블록 수 상한. 뽀모도로형(25~50분) 고티어 봇은 하루 8시간을 채우는 데 13~16블록이 필요하다 —
     * 상한이 이보다 낮으면 목표를 못 채워 강등선 아래로 떨어진다(코드리뷰 반영).
     */
    private static final int MAX_BLOCKS = 16;

    /** 시작 시각 흔들림 상한(분) — 매일 같은 분에 앉는 사람은 없다. */
    private static final int START_JITTER_MINUTES = 180;

    /** 창이 빠듯해도 이만큼은 흔들린다 — 0 이면 매일 같은 분에 앉는 봇이 되어 티가 난다. */
    private static final int MIN_START_JITTER_MINUTES = 45;


    /** 하루 분량 변동폭 — 평균의 75%~125%. */
    private static final double DAILY_VARIANCE_FLOOR = 0.75;
    private static final double DAILY_VARIANCE_RANGE = 0.5;

    /**
     * 누적 집중이 이만큼 쌓이면 다음 휴식이 길어진다(+0~40분 흔들림).
     *
     * <p>2.5시간에 한 번. 더 짧게 잡으면 하루 6~7시간 집중하는 고티어 봇의 긴 휴식이 다섯 번 넘게
     * 끼어 활동 창을 다 먹고, 마지막 블록들이 잘려 강등선 아래로 떨어진다(코드리뷰 반영).
     */
    private static final int LONG_BREAK_AFTER_MINUTES = 150;

    /** 긴 휴식 길이(분) — 최소 + 0~범위. */
    private static final int LONG_BREAK_MIN_MINUTES = 40;
    private static final int LONG_BREAK_RANGE_MINUTES = 60;

    /**
     * 마지막에 남은 몫을 담는 꼬리 블록의 최소 길이(분).
     *
     * <p>스타일별 최소 블록(몰입형은 70분)을 못 채운다고 남은 몫을 통째로 버리면, 그 손실이 쌓여
     * 주간 총량이 강등선 아래로 내려간다. "마지막으로 20분만 더 하고 마무리"는 사람도 하는 일이라
     * 짧은 꼬리 블록을 허용한다(코드리뷰 반영).
     */
    private static final int MIN_TAIL_BLOCK_MINUTES = 15;

    /** 같은 과목을 이만큼 연속하면 다음 블록은 강제로 다른 과목이 된다. */
    private static final int MAX_SAME_SUBJECT_RUN = 2;

    /** 골든 비율 상수 — 날짜가 1 늘 때 시드가 멀리 흩어지도록 섞는 값. */
    private static final long DATE_MIXER = 0x9E3779B97F4A7C15L;

    /** 시드 용도 구분 — 같은 날짜라도 주간 계수와 블록 생성이 다른 난수열을 쓰게 한다. */
    private static final long DAY_SALT = 0L;
    private static final long WEEK_SALT = 0x2545F4914F6CDD1DL;

    private static final int LUNCH_FROM = 11 * 60;
    private static final int LUNCH_TO = 13 * 60;
    private static final int DINNER_FROM = 17 * 60;
    private static final int DINNER_TO = 19 * 60;

    /**
     * 봇별 식사 시각 오프셋의 폭(분) — 결과는 -45 ~ +45.
     *
     * <p>고정 시간대로 두면 <b>모든 봇이 동시에</b> 밥을 먹으러 간다. 실제로 그 시간대에 라이브 봇이
     * 0명이 되는 구간이 생겼다(코드리뷰 반영). 사람마다 저녁 시각이 다른 게 자연스럽기도 하다.
     * 날짜가 아니라 봇 id 로만 정해 한 사람의 식사 시각은 날마다 일정하게 유지한다.
     */
    private static final int MEAL_SHIFT_SPAN = 90;

    /** 식사 오프셋 전용 시드 기준일 — 날짜에 흔들리지 않도록 고정값을 쓴다. */
    private static final LocalDate MEAL_EPOCH = LocalDate.of(2000, 1, 1);
    private static final long MEAL_SALT = 0x9E3779B97F4A7C11L;

    /** 시작 위상 전용 시드 — 봇마다 고정이라 날짜와 무관하다. */
    private static final LocalDate PHASE_EPOCH = LocalDate.of(2000, 1, 2);
    private static final long PHASE_SALT = 0x27BB2EE687B0B0FDL;

    /** 고정 위상을 날마다 흔드는 폭(위상 기준 비율) — ±15%. */
    private static final double DAILY_PHASE_WOBBLE = 0.3;

    /**
     * 봇의 {@code date} 하루치 블록을 시각 오름차순으로 만든다. 쉬는 날이거나 채택 과목이 없으면 빈 목록.
     *
     * @param profile    봇 성향
     * @param date       KST 기준 날짜
     * @param focusTagIds 이 봇이 채택한 과목({@code user_focus_tags.id}) — 블록마다 갈아탄다
     */
    public List<BotFocusBlock> blocksOf(BotProfile profile, LocalDate date, List<UUID> focusTagIds) {
        if (focusTagIds.isEmpty() || profile.restsOn(date.getDayOfWeek())) {
            return List.of();
        }

        Random random = seededFor(profile.getUserId(), date, DAY_SALT);
        double dailyMinutes = profile.averageDailyMinutes() * dayFactor(profile, date);

        BotChronotype chronotype = profile.getChronotype();
        BotStyle style = profile.getStyle();
        int windowEnd = chronotype.windowEndMinute(dailyMinutes);
        int cursor = chronotype.startMinute() + startOffset(profile.getUserId(), random,
                jitterCap(chronotype, dailyMinutes));

        int mealShift = mealShiftOf(profile.getUserId());
        List<BotFocusBlock> blocks = new ArrayList<>();
        int subjectIndex = (int) (random.nextDouble() * focusTagIds.size());
        int spent = 0;
        int sinceLongBreakMinutes = 0;
        int sameSubjectRun = 0;

        while (spent < dailyMinutes && blocks.size() < MAX_BLOCKS) {
            int remaining = (int) dailyMinutes - spent;
            if (remaining < MIN_TAIL_BLOCK_MINUTES) {
                break;
            }
            // 마지막 블록이 목표를 10분까지 넘는 건 둔다 — 분 단위로 딱 떨어지는 쪽이 오히려 부자연스럽다.
            int length = Math.min(style.blockMinutes(random.nextDouble()), remaining + 10);
            if (cursor + length > windowEnd) {
                // 창 끝에 걸렸다고 블록을 통째로 버리지 않고, 남은 창만큼만 앉는다.
                length = windowEnd - cursor;
                if (length < MIN_TAIL_BLOCK_MINUTES) {
                    break;
                }
            }

            blocks.add(new BotFocusBlock(cursor, cursor + length, focusTagIds.get(subjectIndex % focusTagIds.size())));
            spent += length;
            sinceLongBreakMinutes += length;

            int rest = style.restMinutes(random.nextDouble());
            int blockEnd = cursor + length;
            if (isMealTime(blockEnd, mealShift)) {
                rest += 40 + (int) (random.nextDouble() * 40);
                sinceLongBreakMinutes = 0;
            } else if (sinceLongBreakMinutes >= LONG_BREAK_AFTER_MINUTES + (int) (random.nextDouble() * 40)) {
                // 두 시간쯤 하면 크게 쉰다 — 하루가 덩어리로 갈라져야 사람의 하루처럼 보인다.
                // 블록 "개수"가 아니라 누적 집중 "시간" 기준인 이유: 개수로 재면 블록이 짧은
                // 뽀모도로형만 긴 휴식이 잦아져 하루가 창 밖으로 밀리고 목표를 못 채운다(코드리뷰 반영).
                rest += LONG_BREAK_MIN_MINUTES + (int) (random.nextDouble() * LONG_BREAK_RANGE_MINUTES);
                sinceLongBreakMinutes = 0;
            }
            cursor = blockEnd + rest;

            sameSubjectRun++;
            if (sameSubjectRun >= MAX_SAME_SUBJECT_RUN || random.nextDouble() < 0.5) {
                subjectIndex += nextSubjectStep(random, focusTagIds.size());
                sameSubjectRun = 0;
            }
        }
        return blocks;
    }

    /**
     * 그날 시작을 얼마나 늦출지(분).
     *
     * <p>흔들림을 날마다 순수 난수로 뽑으면 어떤 날은 같은 성향의 봇이 <b>전부 늦게</b> 시작해 그
     * 시간대에 라이브 봇이 0명이 되는 구간이 생긴다(코드리뷰 반영). 그래서 봇마다 <b>고정 위상</b>을
     * 주어 시작 시각을 고르게 나눠 갖게 하고, 날짜별로는 그 위상을 소폭만 흔든다. 사람도 자기 리듬이
     * 있고 날마다 조금씩 어긋나는 쪽이라 더 자연스럽다.
     */
    private static int startOffset(UUID userId, Random dayRandom, int jitterCap) {
        double phase = seededFor(userId, PHASE_EPOCH, PHASE_SALT).nextDouble();
        double shifted = phase + (dayRandom.nextDouble() - 0.5) * DAILY_PHASE_WOBBLE;
        return (int) (Math.min(1, Math.max(0, shifted)) * jitterCap);
    }

    /**
     * 시작을 늦출 수 있는 폭. 창이 빠듯한 조합(오후형 고티어처럼 성향 상한이 먼저 걸리는 경우)에서
     * 3시간씩 늦게 시작하면 뒤쪽 블록이 통째로 잘려 주간 총량이 강등선 아래로 떨어진다. 그래서
     * 그날 소요를 뺀 여유 안에서만 흔들되, 최소 흔들림은 남겨 매일 같은 분에 앉지 않게 한다.
     */
    private static int jitterCap(BotChronotype chronotype, double dailyMinutes) {
        int needed = (int) (dailyMinutes * BotChronotype.WINDOW_PER_FOCUS_MINUTE);
        int slack = chronotype.hardEndMinute() - chronotype.startMinute() - needed;
        return Math.max(MIN_START_JITTER_MINUTES, Math.min(START_JITTER_MINUTES, slack));
    }

    /**
     * 과목 전환 폭 — 반드시 1 이상이라 모듈러 후에도 제자리로 돌아오지 않는다.
     * 과목이 하나뿐이면 전환할 곳이 없으므로 그대로 둔다.
     */
    private static int nextSubjectStep(Random random, int subjectCount) {
        if (subjectCount <= 1) {
            return 0;
        }
        return 1 + (int) (random.nextDouble() * (subjectCount - 1));
    }

    private static boolean isMealTime(int minuteOfDay, int mealShift) {
        return (minuteOfDay >= LUNCH_FROM + mealShift && minuteOfDay <= LUNCH_TO + mealShift)
                || (minuteOfDay >= DINNER_FROM + mealShift && minuteOfDay <= DINNER_TO + mealShift);
    }

    /** 이 봇의 식사 시각이 표준에서 얼마나 어긋나는지(분). 날짜와 무관하게 고정이다. */
    private static int mealShiftOf(UUID userId) {
        return (int) (seededFor(userId, MEAL_EPOCH, MEAL_SALT).nextDouble() * MEAL_SHIFT_SPAN)
                - MEAL_SHIFT_SPAN / 2;
    }

    /**
     * 그날 몫의 변동 계수.
     *
     * <p>주(월~일) 7일치를 <b>한 번에 뽑아 활동일 수로 정규화</b>한다 — 하루하루는 흔들리되 주간
     * 합계는 목표에 수렴한다. 날마다 독립적으로 뽑으면 변동이 상쇄되지 않고 어느 주는 목표의 80%에
     * 그치는데, 승강 판정이 절대 시간 기준이라 그 주에 바로 강등된다. 고티어 봇이 이걸 반복하면
     * 상위 티어가 몇 주 만에 비어버린다(코드리뷰 반영).
     */
    private static double dayFactor(BotProfile profile, LocalDate date) {
        LocalDate weekStart = date.with(DayOfWeek.MONDAY);
        Random weekRandom = seededFor(profile.getUserId(), weekStart, WEEK_SALT);
        double[] raw = new double[7];
        double sum = 0;
        for (int i = 0; i < raw.length; i++) {
            if (profile.restsOn(weekStart.plusDays(i).getDayOfWeek())) {
                continue;
            }
            raw[i] = DAILY_VARIANCE_FLOOR + DAILY_VARIANCE_RANGE * weekRandom.nextDouble();
            sum += raw[i];
        }
        if (sum == 0) {
            return 0;
        }
        return raw[date.getDayOfWeek().getValue() - 1] * profile.getActiveDays() / sum;
    }

    /**
     * 시드는 (봇, 날짜, 용도) 로 갈린다. salt 가 없으면 월요일에 한해 주간 계수용 시드와 그날
     * 블록 생성용 시드가 같아져 두 난수열이 붙는다.
     */
    private static Random seededFor(UUID userId, LocalDate date, long salt) {
        long seed = userId.getMostSignificantBits() * 31L
                + userId.getLeastSignificantBits()
                + date.toEpochDay() * DATE_MIXER
                + salt;
        return new Random(seed);
    }
}

package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusTag;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class StatsService {

    private static final long MAX_RANGE_DAYS = 366;

    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final UserStreakRepository userStreakRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final UserRepository userRepository;
    private final FriendshipRepository friendshipRepository;

    /**
     * 통계 조회 대상 userId를 결정한다 (GROMO-608).
     * <p>friends 미지정(null)이면 호출자 본인(self)을 반환한다.
     * friends 지정 시 호출자·대상 User 를 로드한 뒤 <b>ACCEPTED 친구관계만</b> 검증하고
     * 통과하면 대상 friends 를 반환한다. 공개범위(statVisibility) 검증은 결정에 따라 생략한다.
     *
     * @param callerId 호출자(로그인 유저) UUID
     * @param friends  조회 대상 친구 UUID (null 이면 self)
     * @return 실제 통계 집계 대상 userId
     * @throws UserException   대상/호출자 User 미존재 (NOT_FOUND)
     * @throws FriendException 대상과 ACCEPTED 친구관계가 아님 (NOT_FRIEND)
     */
    public UUID resolveTargetUserId(UUID callerId, UUID friends) {
        if (friends == null) {
            return callerId;
        }
        User caller = userRepository.findById(callerId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        User friend = userRepository.findById(friends)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        friendshipRepository.findAcceptedBetween(caller, friend)
                .orElseThrow(() -> new FriendException(FriendErrorCode.NOT_FRIEND));
        return friends;
    }

    public List<HeatmapCellResponse> getHeatmap(UUID userId, LocalDate from, LocalDate to) {
        if (from == null || to == null || from.isAfter(to)
                || ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
            throw new StatsException(StatsErrorCode.INVALID_DATE_RANGE);
        }

        User user = userRepository.getReferenceById(userId);
        // 집중 집계와 스크린타임 집계는 별도 테이블 → 각각 조회 후 날짜로 머지 (HeatmapCellResponse 시그니처는 불변)
        Map<LocalDate, DailyFocusStat> focusByDate = dailyFocusStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, from, to).stream()
                .collect(Collectors.toMap(DailyFocusStat::getDate, Function.identity()));
        Map<LocalDate, DailyScreenTimeStat> screenByDate = dailyScreenTimeStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, from, to).stream()
                .collect(Collectors.toMap(DailyScreenTimeStat::getDate, Function.identity()));

        List<HeatmapCellResponse> cells = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            DailyFocusStat f = focusByDate.get(d);
            DailyScreenTimeStat s = screenByDate.get(d);
            cells.add(new HeatmapCellResponse(
                    d,
                    f != null ? f.getTotalFocusMinutes() : 0,
                    f != null ? f.getSessionCount() : 0,
                    f != null && f.isFocusGoalAchieved(),
                    s != null ? s.getActualScreenTimeMinutes() : 0,
                    s != null && s.isScreenTimeGoalAchieved()));
        }
        return cells;
    }

    public StreakResponse getStreak(UUID userId) {
        User user = userRepository.getReferenceById(userId);
        return userStreakRepository.findByUser(user)
                .map(s -> new StreakResponse(s.getStreakCount(), s.getLongestStreak(), s.getLastSessionDate()))
                .orElseGet(() -> new StreakResponse(0, 0, null));
    }

    /**
     * 오늘의 집중·스크린타임 요약을 통합 반환한다.
     * "오늘"은 유저 country_code 파생 ZoneId 기준 로컬 날짜(미지원·null 은 UTC 폴백).
     * 집계·목표 row 가 없으면 각 값은 0/false, 진행도 0.
     */
    public TodayStatsResponse getTodayStats(UUID userId) {
        // 서버 데이터는 UTC 기준 저장 → "오늘"도 UTC로 산정(friend/group 조회와 동일 기준). 로컬 변환은 클라 담당.
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        LocalDate today = LocalDate.now(ZoneOffset.UTC);

        int focusMinutes = dailyFocusStatRepository.findByUserAndDate(user, today)
                .map(DailyFocusStat::getTotalFocusMinutes).orElse(0);
        int screenMinutes = dailyScreenTimeStatRepository.findByUserAndDate(user, today)
                .map(DailyScreenTimeStat::getActualScreenTimeMinutes).orElse(0);
        int focusGoal = userFocusTimeSettingsRepository.findById(userId)
                .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
        int screenGoal = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::getDailyScreenTimeGoalMinutes).orElse(0);

        return new TodayStatsResponse(
                new TodayStatsResponse.FocusStat(
                        focusMinutes,
                        focusGoal,
                        focusGoal > 0 && focusMinutes >= focusGoal,     // 집중: 분 이상 — 현재 목표로 재계산
                        progressPercent(focusMinutes, focusGoal)),
                new TodayStatsResponse.ScreenTimeStat(
                        screenMinutes,
                        screenGoal,
                        screenGoal > 0 && screenMinutes <= screenGoal,  // 스크린타임: 분 이내 — 현재 목표로 재계산
                        progressPercent(screenMinutes, screenGoal)));
    }

    /**
     * 기간별 집중 시간 통계 조회 (실제 오늘 기준).
     * "오늘"은 UTC 고정 산정. 직전 동일 길이 구간과의 delta를 함께 반환한다.
     */
    public FocusPeriodStatsResponse getFocusStatsByPeriod(UUID userId, StatsPeriod period) {
        return getFocusStatsByPeriod(userId, period, LocalDate.now(ZoneOffset.UTC));
    }

    /**
     * 기간별 집중 시간 통계 조회 — 고정 시각 주입 오버로드 (테스트용, package-private).
     *
     * @param userId 사용자 UUID
     * @param period 조회 기간 단위 (DAY | WEEK | MONTH)
     * @param today  기준 날짜 (UTC)
     */
    FocusPeriodStatsResponse getFocusStatsByPeriod(UUID userId, StatsPeriod period, LocalDate today) {
        User user = userRepository.getReferenceById(userId);
        PeriodRange range = resolvePeriodRange(period, today);

        int current = dailyFocusStatRepository
                .sumTotalFocusMinutesByUserAndDateBetween(user, range.currentFrom(), range.currentTo());
        int previous = dailyFocusStatRepository
                .sumTotalFocusMinutesByUserAndDateBetween(user, range.previousFrom(), range.previousTo());

        return new FocusPeriodStatsResponse(period, range.currentFrom(), range.currentTo(), current, previous,
                current - previous);
    }

    /**
     * 기간별 스크린타임 통계 조회 (실제 오늘 기준).
     * "오늘"은 UTC 고정 산정. 직전 동일 길이 구간과의 delta·목표 달성 정보를 함께 반환한다.
     */
    public ScreenTimePeriodStatsResponse getScreenTimePeriodStats(UUID userId, StatsPeriod period) {
        return getScreenTimePeriodStats(userId, period, LocalDate.now(ZoneOffset.UTC));
    }

    /**
     * 기간별 스크린타임 통계 조회 — 고정 시각 주입 오버로드 (테스트용, package-private).
     *
     * @param userId 사용자 UUID
     * @param period 조회 기간 단위 (DAY | WEEK | MONTH)
     * @param today  기준 날짜 (UTC)
     */
    ScreenTimePeriodStatsResponse getScreenTimePeriodStats(UUID userId, StatsPeriod period, LocalDate today) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 직전 동일 길이 구간: getFocusStatsByPeriod와 공용 헬퍼 사용
        PeriodRange range = resolvePeriodRange(period, today);

        List<DailyScreenTimeStat> currentStats = dailyScreenTimeStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, range.currentFrom(), range.currentTo());
        List<DailyScreenTimeStat> previousStats = dailyScreenTimeStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, range.previousFrom(), range.previousTo());

        int currentMinutes = currentStats.stream()
                .mapToInt(DailyScreenTimeStat::getActualScreenTimeMinutes).sum();
        int previousMinutes = previousStats.stream()
                .mapToInt(DailyScreenTimeStat::getActualScreenTimeMinutes).sum();
        int goalMinutes = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::getDailyScreenTimeGoalMinutes).orElse(0);

        Boolean goalAchieved;
        Integer achievedDays;
        Integer elapsedDays;

        if (period == StatsPeriod.DAY) {
            // day: 서버가 현재 목표로 재계산. 목표 미설정(goalMinutes=0)은 false.
            goalAchieved = goalMinutes > 0 && currentMinutes <= goalMinutes;
            achievedDays = null;
            elapsedDays = null;
        } else {
            // week/month: 저장된 달성 플래그(일 단위) 기반 집계
            goalAchieved = null;
            achievedDays = (int) currentStats.stream()
                    .filter(DailyScreenTimeStat::isScreenTimeGoalAchieved).count();
            elapsedDays = (int) (ChronoUnit.DAYS.between(range.currentFrom(), range.currentTo()) + 1);
        }

        return new ScreenTimePeriodStatsResponse(
                period, range.currentFrom(), range.currentTo(),
                currentMinutes, previousMinutes, currentMinutes - previousMinutes,
                goalMinutes, goalAchieved, achievedDays, elapsedDays);
    }

    /**
     * 카테고리(태그)별 집중 통계 조회 (실제 오늘 기준).
     * 기간 내 완료된 세션을 태그별로 그룹핑하여 누적 집중 시간(분)과 전체 합계를 반환한다.
     * 태그 없는 세션 및 소프트딜리트된 태그의 세션은 '미분류(untagged)' 버킷으로 집계.
     */
    public CategoryFocusStatsResponse getFocusStatsByCategory(UUID userId, StatsPeriod period) {
        return getFocusStatsByCategory(userId, period, LocalDate.now(ZoneOffset.UTC));
    }

    /**
     * 카테고리(태그)별 집중 통계 조회 — 고정 시각 주입 오버로드 (테스트용, package-private).
     *
     * @param userId 사용자 UUID
     * @param period 조회 기간 단위 (DAY | WEEK | MONTH)
     * @param today  기준 날짜 (UTC)
     */
    CategoryFocusStatsResponse getFocusStatsByCategory(UUID userId, StatsPeriod period, LocalDate today) {
        User user = userRepository.getReferenceById(userId);

        // 기간 경계 계산 — resolvePeriodRange 공통 헬퍼 재사용 (DRY: 인라인 switch 중복 제거)
        PeriodRange range = resolvePeriodRange(period, today);
        LocalDate from = range.currentFrom();
        LocalDate to = range.currentTo();

        Instant fromInstant = from.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant toInstant = to.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant(); // exclusive 상한

        List<FocusSession> sessions =
                focusSessionRepository.findCompletedSessionsInPeriod(user, fromInstant, toInstant);

        // 태그별 집계 — Collectors.groupingBy 는 null 키 불가이므로 직접 누적
        Map<UUID, Long> taggedMinutes = new LinkedHashMap<>();
        Map<UUID, String> tagNames = new LinkedHashMap<>();
        long untaggedMinutes = 0L;

        for (FocusSession s : sessions) {
            long mins = Duration.between(s.getStartedAt(), s.getEndedAt()).toMinutes();
            FocusTag tag = s.getFocusTag();
            if (tag == null || tag.getDeletedAt() != null) {
                // 미분류: 태그 없는 세션 + 소프트딜리트된 태그를 참조하는 세션
                untaggedMinutes += mins;
            } else {
                UUID tagId = tag.getId();
                taggedMinutes.merge(tagId, mins, Long::sum);
                tagNames.putIfAbsent(tagId, tag.getName());
            }
        }

        // 전체 합계
        long totalMinutes = taggedMinutes.values().stream().mapToLong(Long::longValue).sum() + untaggedMinutes;

        // items 조립 — 태그별 항목 + 미분류 항목(0분이면 제외) → totalFocusMinutes 내림차순 정렬
        List<CategoryFocusStatsResponse.CategoryItem> items = new ArrayList<>();
        for (Map.Entry<UUID, Long> entry : taggedMinutes.entrySet()) {
            items.add(new CategoryFocusStatsResponse.CategoryItem(
                    entry.getKey(), tagNames.get(entry.getKey()), (int) (long) entry.getValue()));
        }
        if (untaggedMinutes > 0) {
            items.add(new CategoryFocusStatsResponse.CategoryItem(null, null, (int) untaggedMinutes));
        }
        items.sort(Comparator.comparingInt(CategoryFocusStatsResponse.CategoryItem::totalFocusMinutes).reversed());

        return new CategoryFocusStatsResponse(period, from, to, (int) totalMinutes, items);
    }

    /**
     * 기간(period)·기준일(today)로부터 현재 구간과 직전 동일 길이 구간의 경계를 계산한다.
     * DAY  : 오늘 / 어제
     * WEEK : 이번 주 월요일~오늘 / 전주 동일 구간
     * MONTH: 이번 달 1일~오늘 / 전월 1일~전월 동일 날짜
     * GROMO-523·522·524·525 공통 재사용 헬퍼.
     */
    private PeriodRange resolvePeriodRange(StatsPeriod period, LocalDate today) {
        LocalDate currentFrom = switch (period) {
            case DAY -> today;
            case WEEK -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case MONTH -> today.withDayOfMonth(1);
        };
        // 직전 동일 길이 구간: currentFrom~today 와 동일한 날수를 직전에 배치
        LocalDate previousFrom = switch (period) {
            case DAY -> today.minusDays(1);
            case WEEK -> currentFrom.minusWeeks(1);
            case MONTH -> today.minusMonths(1).withDayOfMonth(1);
        };
        LocalDate previousTo = switch (period) {
            case DAY -> today.minusDays(1);
            case WEEK -> today.minusWeeks(1);
            // 전월 같은 날(말일 초과 시 Java가 자동으로 전월 말일로 조정)
            case MONTH -> today.minusMonths(1);
        };
        return new PeriodRange(currentFrom, today, previousFrom, previousTo);
    }

    /** 현재 구간(currentFrom~currentTo)과 직전 동일 길이 구간(previousFrom~previousTo) 경계 묶음. */
    private record PeriodRange(LocalDate currentFrom, LocalDate currentTo,
                               LocalDate previousFrom, LocalDate previousTo) {}

    // 목표 대비 진행도(%). 목표 미설정(0)은 0%, 초과 시 100 초과 그대로 노출(클램프 없음).
    private int progressPercent(int actual, int goal) {
        return goal > 0 ? (int) Math.round((double) actual / goal * 100) : 0;
    }
}

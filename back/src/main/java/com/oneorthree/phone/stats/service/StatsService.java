package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.stats.service.StatsPeriodResolver.PeriodRange;
import com.oneorthree.phone.stats.support.StatsUnits;
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

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
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
    private final StatsPeriodResolver statsPeriodResolver;
    private final StatViewPolicy statViewPolicy;

    /**
     * 통계 조회 대상 userId를 결정한다 (GROMO-608, GROMO-623).
     *
     * <p>열람 권한 판정은 {@link StatViewPolicy} 로 위임한다(GROMO-779 리팩토링). 컨트롤러 호출 계약을
     * 유지하기 위해 서비스에 얇은 위임 메서드로 남긴다.
     *
     * @param callerId 호출자(로그인 유저) UUID
     * @param friends  조회 대상 친구 UUID (null 또는 self 이면 self)
     * @return 실제 통계 집계 대상 userId
     * @throws UserException   대상/호출자 User 미존재 (NOT_FOUND)
     * @throws com.oneorthree.phone.friend.exception.FriendException 친구도 아니고 대상 공개범위도 PUBLIC 이 아님
     *                                                              (NOT_FRIEND)
     */
    public UUID resolveTargetUserId(UUID callerId, UUID friends) {
        return statViewPolicy.resolveTargetUserId(callerId, friends);
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
                    f != null ? StatsUnits.secondsToMinutes(f.getTotalFocusSeconds()) : 0,   // GROMO-642: 초 → 분
                    f != null ? f.getSessionCount() : 0,
                    f != null && f.isFocusTimeGoalAchieved(),
                    s != null ? s.getTotalScreenTimeMinutes() : 0,
                    s != null && s.isScreenTimeGoalAchieved()));
        }
        return cells;
    }

    public StreakResponse getStreak(UUID userId) {
        User user = userRepository.getReferenceById(userId);
        return userStreakRepository.findByUser(user)
                .map(s -> new StreakResponse(s.getStreakCount(), s.getLongestStreakCount(), s.getLastSessionDate()))
                .orElseGet(() -> new StreakResponse(0, 0, null));
    }

    /**
     * 오늘의 집중·스크린타임 요약을 통합 반환한다.
     * "오늘"은 클라가 로컬 타임존 기준으로 전달한 날짜(GROMO-643) — 서버는 UTC 변환 없이 그대로 조회.
     * 집계·목표 row 가 없으면 각 값은 0/false, 진행도 0.
     */
    public TodayStatsResponse getTodayStats(UUID userId, LocalDate today) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        int focusMinutes = dailyFocusStatRepository.findByUserAndDate(user, today)
                .map(d -> StatsUnits.secondsToMinutes(d.getTotalFocusSeconds())).orElse(0);   // GROMO-642: 초→분
        int screenMinutes = dailyScreenTimeStatRepository.findByUserAndDate(user, today)
                .map(DailyScreenTimeStat::getTotalScreenTimeMinutes).orElse(0);
        int focusGoal = userFocusTimeSettingsRepository.findById(userId)
                .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
        int screenGoal = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::getDailyScreenTimeGoalMinutes).orElse(0);

        return new TodayStatsResponse(
                new TodayStatsResponse.FocusStat(
                        focusMinutes,
                        focusGoal,
                        focusGoal > 0 && focusMinutes >= focusGoal,     // 집중: 분 이상 — 현재 목표로 재계산
                        StatsUnits.progressPercent(focusMinutes, focusGoal)),
                new TodayStatsResponse.ScreenTimeStat(
                        screenMinutes,
                        screenGoal,
                        screenGoal > 0 && screenMinutes <= screenGoal,  // 스크린타임: 분 이내 — 현재 목표로 재계산
                        StatsUnits.progressPercent(screenMinutes, screenGoal)));
    }

    /**
     * 기간별 집중 시간 통계 조회. "오늘"은 클라가 전달한 로컬 날짜(GROMO-643).
     * 직전 동일 길이 구간과의 delta를 함께 반환한다.
     *
     * @param today 클라 로컬 기준 날짜
     */
    public FocusPeriodStatsResponse getFocusStatsByPeriod(UUID userId, StatsPeriod period, LocalDate today) {
        User user = userRepository.getReferenceById(userId);
        PeriodRange range = statsPeriodResolver.resolve(period, today);

        // GROMO-642: 초로 합산 후 분 환산(1회) — 세션별 내림 손실 제거
        int current = StatsUnits.secondsToMinutes(dailyFocusStatRepository
                .sumTotalFocusSecondsByUserAndDateBetween(user, range.currentFrom(), range.currentTo()));
        int previous = StatsUnits.secondsToMinutes(dailyFocusStatRepository
                .sumTotalFocusSecondsByUserAndDateBetween(user, range.previousFrom(), range.previousTo()));

        return new FocusPeriodStatsResponse(period, range.currentFrom(), range.currentTo(), current, previous,
                current - previous);
    }

    /**
     * 기간별 스크린타임 통계 조회. "오늘"은 클라가 전달한 로컬 날짜(GROMO-643).
     * 직전 동일 길이 구간과의 delta·목표 달성 정보를 함께 반환한다.
     *
     * @param today 클라 로컬 기준 날짜
     */
    public ScreenTimePeriodStatsResponse getScreenTimePeriodStats(UUID userId, StatsPeriod period, LocalDate today) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 직전 동일 길이 구간: getFocusStatsByPeriod와 공용 리졸버 사용
        PeriodRange range = statsPeriodResolver.resolve(period, today);

        List<DailyScreenTimeStat> currentStats = dailyScreenTimeStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, range.currentFrom(), range.currentTo());
        List<DailyScreenTimeStat> previousStats = dailyScreenTimeStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, range.previousFrom(), range.previousTo());

        int currentMinutes = currentStats.stream()
                .mapToInt(DailyScreenTimeStat::getTotalScreenTimeMinutes).sum();
        int previousMinutes = previousStats.stream()
                .mapToInt(DailyScreenTimeStat::getTotalScreenTimeMinutes).sum();
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
    public CategoryFocusStatsResponse getFocusStatsByCategory(UUID userId, StatsPeriod period, LocalDate today) {
        User user = userRepository.getReferenceById(userId);

        // 기간 경계 계산 — StatsPeriodResolver 공통 리졸버 재사용 (DRY: 인라인 switch 중복 제거)
        PeriodRange range = statsPeriodResolver.resolve(period, today);
        LocalDate from = range.currentFrom();
        LocalDate to = range.currentTo();

        // GROMO-671(커밋3): local_date 제거로 endedAt(UTC) 윈도우 기준 조회 — [from 00:00, to+1 00:00) 반열림 구간.
        Instant fromInstant = from.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant toInstant = to.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        List<FocusSession> sessions =
                focusSessionRepository.findCompletedSessionsInPeriod(user, fromInstant, toInstant);

        // 태그별 집계 — Collectors.groupingBy 는 null 키 불가이므로 직접 누적 (GROMO-642: 세션별 분 내림 제거 → 초 누적)
        Map<UUID, Long> taggedSeconds = new LinkedHashMap<>();
        Map<UUID, String> tagNames = new LinkedHashMap<>();
        long untaggedSeconds = 0L;

        for (FocusSession s : sessions) {
            long secs = Duration.between(s.getStartedAt(), s.getEndedAt()).getSeconds();
            // GROMO-673: 태그는 user_focus_tags. 버킷 키는 user_focus_tags.id, 이름은 defaultTag.name.
            UserFocusTag tag = s.getFocusTag();
            if (tag == null || tag.getDeletedAt() != null) {
                // 미분류: 태그 없는 세션 + 소프트딜리트된 태그를 참조하는 세션
                untaggedSeconds += secs;
            } else {
                UUID tagId = tag.getId();
                taggedSeconds.merge(tagId, secs, Long::sum);
                tagNames.putIfAbsent(tagId, tag.getDefaultTag().getName());
            }
        }

        // total 은 전체 초합을 1회 내림(GROMO-642) — 태그별로 먼저 내림해 합하면 자투리 초가 태그마다 소실돼
        // /stats/focus 와 어긋난다(예: 30초+30초 → category 0분 vs focus 1분). total 은 초합 기준으로 정합.
        long totalSeconds = untaggedSeconds
                + taggedSeconds.values().stream().mapToLong(Long::longValue).sum();
        int totalMinutes = (int) (totalSeconds / 60);

        // items 는 태그별 분(표시 단위) — 개별 항목은 분 내림. total 과 items 합은 다를 수 있음(total 이 정확값).
        List<CategoryFocusStatsResponse.CategoryItem> items = new ArrayList<>();
        for (Map.Entry<UUID, Long> entry : taggedSeconds.entrySet()) {
            items.add(new CategoryFocusStatsResponse.CategoryItem(
                    entry.getKey(), tagNames.get(entry.getKey()), (int) (entry.getValue() / 60)));
        }
        int untaggedMinutes = (int) (untaggedSeconds / 60);
        if (untaggedMinutes > 0) {
            items.add(new CategoryFocusStatsResponse.CategoryItem(null, null, untaggedMinutes));
        }
        items.sort(Comparator.comparingInt(CategoryFocusStatsResponse.CategoryItem::totalFocusMinutes).reversed());

        return new CategoryFocusStatsResponse(period, from, to, totalMinutes, items);
    }
}

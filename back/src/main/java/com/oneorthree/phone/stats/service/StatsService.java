package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.stats.service.StatsPeriodResolver.PeriodRange;
import com.oneorthree.phone.stats.support.StatsUnits;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.stats.dto.FocusAverageAggregate;
import com.oneorthree.phone.stats.dto.FocusAverageResponse;
import com.oneorthree.phone.stats.dto.FocusAverageScope;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.domain.Occupation;
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
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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

    /**
     * 스트릭(연속일) 조회. currentStreak 은 read-time 으로 만료를 반영한다(GROMO-847) —
     * lastSessionDate 가 어제 이전이면 공백으로 끊긴 것으로 보아 0 을 반환한다(판정은 {@link UserStreak}).
     * longestStreak·lastSessionDate 는 저장된 원본을 그대로 유지한다.
     *
     * @param today 클라 로컬 기준 오늘(GROMO-643)
     */
    public StreakResponse getStreak(UUID userId, LocalDate today) {
        User user = userRepository.getReferenceById(userId);
        return userStreakRepository.findByUser(user)
                .map(s -> new StreakResponse(
                        s.currentStreakAsOf(today), s.getLongestStreakCount(), s.getLastSessionDate()))
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
     * 기간별 평균 집중시간 집계 조회 (GROMO-753).
     *
     * <p>모수(scope) 유저 중 해당 기간 활동(row&ge;1)한 유저만 대상으로,
     * {@code averageMinutes = floor( SUM(집중 초) / 활동 유저 수 / 60 )} 을 반환한다.
     * per-user 열람권한은 불요(집계라 개인 데이터 미노출).
     *
     * <ul>
     *   <li>FRIENDS : 호출자 ACCEPTED 친구 집합(자기 자신 미포함). 친구 0명이면 null/0.</li>
     *   <li>TOTAL   : 전체 유저(탈퇴 제외, 자기 자신 포함).</li>
     *   <li>CATEGORY: 호출자와 같은 occupation 유저(자기 자신 포함). occupation 미설정이면 400 아닌 null 응답.</li>
     * </ul>
     *
     * <p>휴면 유저(기간 내 row 없음)는 모수에서 자연 제외(평균 희석 방지). 활동 유저 0명이면
     * {@code averageMinutes=null, sampleSize=0}.
     *
     * @param callerId 호출자(로그인 유저) UUID
     * @param scope    집계 모수(FRIENDS/TOTAL/CATEGORY)
     * @param period   집계 기간(DAY/WEEK/MONTH)
     * @param date     클라 로컬 기준 날짜
     */
    public FocusAverageResponse getFocusAverage(
            UUID callerId, FocusAverageScope scope, StatsPeriod period, LocalDate date) {
        PeriodRange range = statsPeriodResolver.resolve(period, date);
        LocalDate from = range.currentFrom();
        LocalDate to = range.currentTo();

        FocusAverageAggregate aggregate = switch (scope) {
            case FRIENDS -> {
                User caller = userRepository.getReferenceById(callerId);
                // 상대(친구) User 집합 — caller 는 친구 집합에 미포함이라 자연 제외. Set 으로 중복 방지.
                Set<User> friends = friendshipRepository.findAcceptedByUser(caller).stream()
                        .map(f -> counterpart(f, callerId))
                        .collect(Collectors.toSet());
                // 친구 0명이면 빈 IN 절 회피 위해 사전 차단 → null 응답.
                yield friends.isEmpty()
                        ? null
                        : dailyFocusStatRepository.sumAndActiveCountByUsersInPeriod(friends, from, to);
            }
            case TOTAL -> dailyFocusStatRepository.sumAndActiveCountAllInPeriod(from, to);
            case CATEGORY -> {
                Occupation occupation = userRepository.findById(callerId)
                        .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND))
                        .getOccupation();
                // occupation 미설정: 에러 아님 → 활동 유저 0 취급으로 null 응답(클라는 해당 축 숨김).
                yield occupation == null
                        ? null
                        : dailyFocusStatRepository.sumAndActiveCountByOccupationInPeriod(occupation, from, to);
            }
        };

        // 활동 유저 0명(친구 없음/occupation 미설정/무활동): averageMinutes=null, sampleSize=0.
        if (aggregate == null || aggregate.activeUserCount() == 0) {
            return new FocusAverageResponse(scope, period, from, to, null, 0);
        }
        // 초 합산 후 인원으로 나누고 분 내림(정수 나눗셈=floor) — /stats/focus 내림 규칙과 정합.
        int averageMinutes = (int) (aggregate.totalSeconds() / aggregate.activeUserCount() / 60);
        return new FocusAverageResponse(scope, period, from, to, averageMinutes, (int) aggregate.activeUserCount());
    }

    /** 친구 관계에서 호출자(me)가 아닌 상대 User 를 반환한다. */
    private User counterpart(Friendship friendship, UUID me) {
        return friendship.getFromUser().getId().equals(me)
                ? friendship.getToUser()
                : friendship.getFromUser();
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

        // 가입일(유저존 로컬 날짜) — createdAt 미상이면 null(클램프/필터 없음). day 카운트와 분 합계가 같은 기준을 쓰도록
        // 한 번만 계산해 재사용한다(Codex P2: 가입 전 레거시 row 는 분 합계에서도 제외해야 day 카운트와 정합).
        LocalDate joinLocalDate = joinLocalDate(user);

        // 가입 전 레거시 row(date < 가입일)는 분 합계·delta 에서도 제외한다 — day 클램프로 경과일에선 이미 빠지므로
        // 분만 포함되면 불일치. joinLocalDate == null 이면 필터 없음.
        int currentMinutes = sumMinutesFromJoin(currentStats, joinLocalDate);
        int previousMinutes = sumMinutesFromJoin(previousStats, joinLocalDate);
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
            // week/month (GROMO-805): 경과일수는 가입일로 클램프한다 — 가입 전 날은 집계 대상이 아니다.
            // clampedFrom = max(구간 시작, 가입일 유저존 로컬 날짜). createdAt 미상이면 클램프 없음.
            goalAchieved = null;
            LocalDate clampedFrom = joinLocalDate != null && joinLocalDate.isAfter(range.currentFrom())
                    ? joinLocalDate : range.currentFrom();
            int clampedElapsedDays = clampedFrom.isAfter(range.currentTo())
                    ? 0
                    : (int) (ChronoUnit.DAYS.between(clampedFrom, range.currentTo()) + 1);
            elapsedDays = clampedElapsedDays;   // 승인 결정: elapsedDays 도 가입 클램프 반영해 일관

            if (goalMinutes > 0) {
                // 목표 설정 유저: day 뷰와 의미 일치 — row 없는 날 = 0분 = 달성. 실패한 날만 차감.
                // achievedDays = clampedElapsedDays − (과거 확정 실패 + 오늘 실패).
                // ① 과거 확정일(clampedFrom ≤ date < today): 저장 플래그(!isScreenTimeGoalAchieved)로 실패 판정.
                //    가입 전(clampedFrom 이전) row 는 그 구간에 속하지 않으므로 차감 대상이 아니다(과소·음수 방지).
                // ② 오늘(date == anchorDay): final row 는 저장 스냅샷을 쓰고, interim row 는 day 뷰와 동일하게 현재 목표로
                //    재계산한다(todayMinutes > goalMinutes 이면 실패). 오늘이 clampedFrom 이전(가입 전)이면 경과일에 없으므로 세지 않는다.
                //    anchorDay = range.currentTo() = today 파라미터.
                LocalDate anchorDay = range.currentTo();
                int pastFailed = (int) currentStats.stream()
                        .filter(s -> !s.getDate().isBefore(clampedFrom))
                        .filter(s -> s.getDate().isBefore(anchorDay))
                        .filter(s -> !s.isScreenTimeGoalAchieved()).count();
                int todayFailed = 0;
                if (!anchorDay.isBefore(clampedFrom)) {
                    List<DailyScreenTimeStat> todayStats = currentStats.stream()
                            .filter(s -> s.getDate().isEqual(anchorDay))
                            .toList();
                    Optional<DailyScreenTimeStat> finalizedToday = todayStats.stream()
                            .filter(DailyScreenTimeStat::isScreenTimeFinalized)
                            .findFirst();
                    if (finalizedToday.isPresent()) {
                        todayFailed = finalizedToday.get().isScreenTimeGoalAchieved() ? 0 : 1;
                    } else {
                        int todayMinutes = todayStats.stream()
                                .mapToInt(DailyScreenTimeStat::getTotalScreenTimeMinutes).sum();
                        todayFailed = todayMinutes > goalMinutes ? 1 : 0;
                    }
                }
                achievedDays = clampedElapsedDays - (pastFailed + todayFailed);
            } else {
                // 목표 미설정: day 뷰와 동일하게 달성 판정을 하지 않는다 — 저장 플래그(모두 false) 기준이라 0.
                achievedDays = (int) currentStats.stream()
                        .filter(s -> !s.getDate().isBefore(clampedFrom))
                        .filter(DailyScreenTimeStat::isScreenTimeGoalAchieved).count();
            }
        }

        return new ScreenTimePeriodStatsResponse(
                period, range.currentFrom(), range.currentTo(),
                currentMinutes, previousMinutes, currentMinutes - previousMinutes,
                goalMinutes, goalAchieved, achievedDays, elapsedDays);
    }

    /**
     * 가입일을 유저존 로컬 날짜로 환산한다(GROMO-805) — 가입 전 날을 집계에서 제외하기 위한 공통 기준.
     * {@code user.createdAt} 을 유저 country_code 파생 존(GROMO-561, 스크린타임 쓰기 버킷과 동일 존)의 로컬 날짜로
     * 환산한다. {@code createdAt} 이 null(테스트/레거시)이면 {@code null} 을 반환해 호출부가 클램프/필터를 생략한다.
     */
    private LocalDate joinLocalDate(User user) {
        if (user.getCreatedAt() == null) {
            return null;
        }
        return user.getCreatedAt().atZone(CountryZoneResolver.resolve(user.getCountryCode())).toLocalDate();
    }

    /**
     * 가입 전 레거시 row(date &lt; joinLocalDate)를 제외하고 분 합계를 낸다(Codex P2) — day 카운트가 가입일로
     * 클램프되므로 분 합계·delta 도 같은 기준으로 맞춰 불일치를 없앤다. {@code joinLocalDate == null}(가입일 미상)이면
     * 필터 없이 전체를 합산한다.
     */
    private int sumMinutesFromJoin(List<DailyScreenTimeStat> stats, LocalDate joinLocalDate) {
        return stats.stream()
                .filter(s -> joinLocalDate == null || !s.getDate().isBefore(joinLocalDate))
                .mapToInt(DailyScreenTimeStat::getTotalScreenTimeMinutes)
                .sum();
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

        // GROMO-803: endedAt 윈도우도 유저 country_code 존 기준으로 정합 — [from 00:00, to+1 00:00) 반열림 구간.
        // 일별 버킷(DailyFocusStat)이 존 로컬 날짜가 됐으므로, by-category 윈도우도 같은 존으로 열어야 경계 세션이
        // 두 집계에서 동일한 날에 귀속된다. countryCode null·미지원은 Asia/Seoul 폴백(CountryZoneResolver).
        ZoneId zone = CountryZoneResolver.resolve(user.getCountryCode());
        Instant fromInstant = from.atStartOfDay(zone).toInstant();
        Instant toInstant = to.plusDays(1).atStartOfDay(zone).toInstant();
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

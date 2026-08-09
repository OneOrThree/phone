package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.NavigableSet;
import java.util.TreeSet;

/**
 * 세션 완료 시 집중 스트릭(연속 일수) 갱신.
 *
 * <p>날짜 기준은 유저 country_code 존 로컬 날짜 — DailyFocusStat 집계 관례와 동일(GROMO-803).
 * 조회 경로(StatsService.getStreak)는 건드리지 않고 쓰기 로직만 이 서비스가 소유한다.
 */
@Service
@RequiredArgsConstructor
public class UserStreakService {

    private final UserStreakRepository userStreakRepository;
    private final UserActivityEventLogger userActivityEventLogger;

    /**
     * 세션 완료에 따른 스트릭 갱신 + 변화가 있을 때만 STREAK_UPDATED 발행.
     * FocusService.saveFocusSession 의 트랜잭션에 참여해 세션 저장과 원자적으로 반영된다.
     *
     * <p>자정을 걸친 세션은 여러 날짜를 인정할 수 있으므로 <b>그 세션이 인정한 날짜 전부</b>를 한 번에 받는다 —
     * 반영 순서를 lastSessionDate 를 아는 이쪽에서 정해야 하기 때문이다(아래 '반영 순서').
     *
     * <p>날짜 1건당 갱신 규칙:
     * <ul>
     *   <li>row 없음 또는 lastSessionDate == null → streakCount = 1 (change=started)</li>
     *   <li>sessionDate == lastSessionDate → 무변화, 이벤트 미발행</li>
     *   <li>sessionDate == lastSessionDate + 1일 → streakCount + 1 (change=extended)</li>
     *   <li>sessionDate 가 lastSessionDate + 1일보다 뒤 → streakCount = 1 리셋 (change=reset)</li>
     *   <li>sessionDate 가 현재 연속 구간 안 → 무변화, 미발행 (이미 계수된 날)</li>
     *   <li>sessionDate == 연속 구간 시작 − 1일 → streakCount + 1 (change=backfilled, 소급 연장)</li>
     *   <li>그보다 더 과거 → 무변화, 미발행 (공백이 남아 있어 이어지지 않는다)</li>
     * </ul>
     * 공통: lastSessionDate = max(기존, sessionDate), longestStreakCount = max(longestStreakCount, streakCount).
     *
     * <p><b>소급 연장 (GROMO-1252 코드리뷰 ③)</b>: 종전엔 lastSessionDate 이하 날짜를 통째로 무시해,
     * 오프라인 지연 업로드로 종료일이 이미 기록된 뒤 자정을 걸친 세션의 <b>어제 조각</b>이 들어오면
     * DailyFocusStat 은 어제를 인정하는데 스트릭만 복구되지 않았다. 현재 연속 구간은
     * {@code [lastSessionDate − (streakCount−1), lastSessionDate]} 이므로, 그 시작 바로 앞날이 자격을 갖추면
     * 구간이 하루 뒤로 늘어난다(+1). 구간 안 날짜는 이미 계수돼 무변화 — 이중 가산이 없다.
     *
     * <p><b>반영 순서 (코드리뷰 3차 ③)</b>: 소급 규칙이 '구간 시작 바로 앞날'만 인정하므로 한 요청의 여러
     * 날짜를 오름차순으로 낱개 반영하면 오래된 쪽이 유실된다 — 8~9 스트릭에 6·7 지연 세션이 오면 6 이
     * 먼저 들어가 무시되고(그때 구간 시작은 8), 7 이 구간을 7~9 로 늘린 뒤엔 6 이 다시 고려되지 않아
     * 3 에 멈춘다(4 여야 함). 그래서 <b>소급(≤ lastSessionDate)은 최신→과거, 미래는 과거→최신</b> 순으로
     * 반영한다: 소급은 구간 시작을 하루씩 앞당기며 이어지고(7 → 6 = 4), 미래는 연장(+1일) 판정이 순서대로
     * 성립한다(미래를 뒤집으면 가장 늦은 날짜가 먼저 들어가 reset 으로 끊긴다). 소급 반영은
     * lastSessionDate 를 바꾸지 않으므로 두 그룹의 분류는 시작 시점 값 하나로 고정해도 안전하다.
     *
     * <p>동시성: 동시 INSERT race 는 user_id unique 제약이 정합성을 보장한다
     * (실패 건은 클라 재시도 — DailyFocusStat upsert 의 INSERT-INSERT 방어와 동일).
     * UPDATE-UPDATE race 는 날짜 경계를 걸친 동시 저장에서만 의미가 있어 잠금 없이 단순 구현.
     *
     * @param user         세션을 완료한 유저
     * @param sessionDates 이 세션이 스트릭 인정 기준을 채운 날짜들(유저 존 로컬 날짜. 순서·중복 무관)
     */
    @Transactional
    public void updateOnSessionComplete(User user, Collection<LocalDate> sessionDates) {
        if (sessionDates == null || sessionDates.isEmpty()) {
            return;
        }
        UserStreak streak = userStreakRepository.findByUser(user).orElse(null);
        boolean isNew = streak == null;
        if (isNew) {
            // upsert: row 없으면 생성 — 가입 훅에서 만들지 않으므로 기존 유저도 여기서 커버
            streak = UserStreak.builder().user(user).build();
        }

        for (LocalDate sessionDate : orderForApply(sessionDates, streak.getLastSessionDate())) {
            String change = apply(streak, sessionDate);
            if (change == null) {
                continue;
            }
            userActivityEventLogger.log(UserActivityEvent.STREAK_UPDATED,
                    Map.of("streak_count", streak.getStreakCount(),
                            "longest_streak", streak.getLongestStreakCount(),
                            "change", change));
        }

        if (isNew) {
            userStreakRepository.save(streak);
        }
    }

    /** 소급(≤ last)은 최신→과거, 미래는 과거→최신. 근거는 클래스 메서드 주석의 '반영 순서' 참고. */
    private static List<LocalDate> orderForApply(Collection<LocalDate> sessionDates, LocalDate lastSessionDate) {
        NavigableSet<LocalDate> sorted = new TreeSet<>(sessionDates);
        if (lastSessionDate == null) {
            return List.copyOf(sorted);
        }
        List<LocalDate> ordered = new ArrayList<>(sorted.headSet(lastSessionDate, true).descendingSet());
        ordered.addAll(sorted.tailSet(lastSessionDate, false));
        return ordered;
    }

    /** 날짜 1건 반영 — 변화가 있으면 change 라벨, 무변화(이미 계수된 날·이어지지 않는 과거)면 null. */
    private static String apply(UserStreak streak, LocalDate sessionDate) {
        LocalDate lastSessionDate = streak.getLastSessionDate();
        String change;
        if (lastSessionDate == null) {
            streak.setStreakCount(1);
            streak.setLastSessionDate(sessionDate);
            change = "started";
        } else if (sessionDate.isAfter(lastSessionDate)) {
            if (sessionDate.equals(lastSessionDate.plusDays(1))) {
                streak.setStreakCount(streak.getStreakCount() + 1);
                change = "extended";
            } else {
                streak.setStreakCount(1);
                change = "reset";
            }
            streak.setLastSessionDate(sessionDate);
        } else {
            // 소급 도착(같은 날 재호출 / 자정 걸친 세션의 어제 조각 / 오프라인 지연 업로드).
            // 현재 연속 구간 = [lastSessionDate − (streakCount−1), lastSessionDate].
            // 구간 시작 바로 앞날이면 구간이 하루 뒤로 늘어나고, 그 외(구간 안·더 과거)는 무변화.
            LocalDate runStart = lastSessionDate.minusDays(Math.max(0, streak.getStreakCount() - 1));
            if (!sessionDate.equals(runStart.minusDays(1))) {
                return null;
            }
            streak.setStreakCount(streak.getStreakCount() + 1);
            change = "backfilled";
            // lastSessionDate 는 유지 — 구간의 '끝'은 그대로고 '시작'만 앞당겨졌다.
            // (조회 만료 판정 UserStreak.currentStreakAsOf 은 끝 날짜 기준이라 여기서 바꾸면 안 된다.)
        }
        streak.setLongestStreakCount(Math.max(streak.getLongestStreakCount(), streak.getStreakCount()));
        return change;
    }
}

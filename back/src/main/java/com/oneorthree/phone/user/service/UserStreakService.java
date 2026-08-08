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
import java.util.Map;

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
     * <p>갱신 규칙:
     * <ul>
     *   <li>row 없음 또는 lastSessionDate == null → streakCount = 1 (change=started)</li>
     *   <li>sessionDate == lastSessionDate → 무변화, 이벤트 미발행</li>
     *   <li>sessionDate == lastSessionDate + 1일 → streakCount + 1 (change=extended)</li>
     *   <li>sessionDate > lastSessionDate + 1일 → streakCount = 1 리셋 (change=reset)</li>
     *   <li>sessionDate < lastSessionDate (과거 세션 소급 저장) → 무변화, 미발행 (방어)</li>
     * </ul>
     * 공통: lastSessionDate = max(기존, sessionDate), longestStreakCount = max(longestStreakCount, streakCount).
     *
     * <p><b>호출 순서가 계약이다 (GROMO-1252)</b>: 위 4번째 규칙대로 lastSessionDate 이하 날짜는 조용히 무시된다.
     * 자정을 걸친 세션처럼 한 요청이 여러 날짜를 갱신할 때는 <b>반드시 날짜 오름차순</b>으로 호출해야 한다
     * (오늘을 먼저 넣으면 어제 호출이 무시된다).
     *
     * <p>동시성: 동시 INSERT race 는 user_id unique 제약이 정합성을 보장한다
     * (실패 건은 클라 재시도 — DailyFocusStat upsert 의 INSERT-INSERT 방어와 동일).
     * UPDATE-UPDATE race 는 날짜 경계를 걸친 동시 저장에서만 의미가 있어 잠금 없이 단순 구현.
     *
     * @param user           세션을 완료한 유저
     * @param sessionDateUtc 세션 endedAt 의 UTC 날짜
     */
    @Transactional
    public void updateOnSessionComplete(User user, LocalDate sessionDateUtc) {
        UserStreak streak = userStreakRepository.findByUser(user).orElse(null);
        boolean isNew = streak == null;
        if (isNew) {
            // upsert: row 없으면 생성 — 가입 훅에서 만들지 않으므로 기존 유저도 여기서 커버
            streak = UserStreak.builder().user(user).build();
        }

        LocalDate lastSessionDate = streak.getLastSessionDate();
        if (lastSessionDate != null && !sessionDateUtc.isAfter(lastSessionDate)) {
            // 같은 날 두 번째 세션(무변화) 또는 과거 세션 소급 저장(방어) → 이벤트 미발행
            return;
        }

        String change;
        if (lastSessionDate == null) {
            streak.setStreakCount(1);
            change = "started";
        } else if (sessionDateUtc.equals(lastSessionDate.plusDays(1))) {
            streak.setStreakCount(streak.getStreakCount() + 1);
            change = "extended";
        } else {
            streak.setStreakCount(1);
            change = "reset";
        }
        streak.setLastSessionDate(sessionDateUtc);
        streak.setLongestStreakCount(Math.max(streak.getLongestStreakCount(), streak.getStreakCount()));

        if (isNew) {
            userStreakRepository.save(streak);
        }

        userActivityEventLogger.log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", streak.getStreakCount(),
                        "longest_streak", streak.getLongestStreakCount(),
                        "change", change));
    }
}

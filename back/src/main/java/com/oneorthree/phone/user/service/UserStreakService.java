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
     * 덕분에 한 요청이 여러 날짜를 갱신할 때 <b>호출 순서에 무관</b>해졌다(종전의 오름차순 강제 계약 해소).
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
        String change;
        if (lastSessionDate == null) {
            streak.setStreakCount(1);
            streak.setLastSessionDate(sessionDateUtc);
            change = "started";
        } else if (sessionDateUtc.isAfter(lastSessionDate)) {
            if (sessionDateUtc.equals(lastSessionDate.plusDays(1))) {
                streak.setStreakCount(streak.getStreakCount() + 1);
                change = "extended";
            } else {
                streak.setStreakCount(1);
                change = "reset";
            }
            streak.setLastSessionDate(sessionDateUtc);
        } else {
            // 소급 도착(같은 날 재호출 / 자정 걸친 세션의 어제 조각 / 오프라인 지연 업로드).
            // 현재 연속 구간 = [lastSessionDate − (streakCount−1), lastSessionDate].
            // 구간 시작 바로 앞날이면 구간이 하루 뒤로 늘어나고, 그 외(구간 안·더 과거)는 무변화.
            LocalDate runStart = lastSessionDate.minusDays(Math.max(0, streak.getStreakCount() - 1));
            if (!sessionDateUtc.equals(runStart.minusDays(1))) {
                return;
            }
            streak.setStreakCount(streak.getStreakCount() + 1);
            change = "backfilled";
            // lastSessionDate 는 유지 — 구간의 '끝'은 그대로고 '시작'만 앞당겨졌다.
            // (조회 만료 판정 UserStreak.currentStreakAsOf 은 끝 날짜 기준이라 여기서 바꾸면 안 된다.)
        }
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

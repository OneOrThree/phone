package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ScreenTimeService {

    private final UserRepository userRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final ScreenTimeNotificationPort notificationPort;
    private final UserActivityEventLogger userActivityEventLogger;

    @Transactional
    public void saveScreenTime(UUID userId, ScreenTimeRequest request) {
        // 1. 유저 조회
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 2. reportedAt → 유저 country_code 파생 ZoneId 기준 로컬 날짜 환산 (자정 경계 오귀속 방지)
        LocalDate date = resolveLocalDate(user, request);

        // 3. daily_screen_time_stats upsert (user, date) 기준 — 멱등
        int actualMinutes = request.getActualScreenTimeMinutes() != null
                ? request.getActualScreenTimeMinutes() : 0;

        // GROMO-805: 목표 달성은 클라 신뢰(request.getScreenTimeGoalAchieved()) 대신 서버가 판정한다.
        // goal(분) 미설정(0)이면 판정 안 함(false). 스크린타임은 '이내(actual <= goal)'가 달성 — 집중의 '이상'과 방향 반대.
        // (focus 의 서버 단방향 flag 와 동일 원칙 — 주체를 서버로 통일. 클라 필드는 무시한다.)
        int goal = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::getDailyScreenTimeGoalMinutes).orElse(0);
        boolean goalAchieved = goal > 0 && actualMinutes <= goal;
        Optional<DailyScreenTimeStat> existing =
                dailyScreenTimeStatRepository.findByUserAndDate(user, date);
        // false→true 전이 여부 — 기존 row 미달성 & 요청 달성, 또는 신규 row 가 곧바로 달성
        boolean transitioned;
        if (existing.isPresent()) {
            DailyScreenTimeStat stat = existing.get();
            transitioned = !stat.isScreenTimeGoalAchieved() && goalAchieved;
            stat.setTotalScreenTimeMinutes(actualMinutes);
            stat.setScreenTimeGoalAchieved(goalAchieved);
        } else {
            transitioned = goalAchieved;
            dailyScreenTimeStatRepository.save(DailyScreenTimeStat.builder()
                    .user(user)
                    .date(date)
                    .totalScreenTimeMinutes(actualMinutes)
                    .isScreenTimeGoalAchieved(goalAchieved)
                    .build());
        }

        // false→true 전이 순간에만 1회 발행 — true→true 재전송은 미발행 (GROMO-395)
        // GROMO-805: 전이 판정도 서버 판정값(goalAchieved) 기준 — 알림 트리거(395)가 서버 판정으로 바뀐다(프론트 공유).
        if (transitioned) {
            userActivityEventLogger.log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED, Map.of(
                    "date", date.toString(),
                    "actual_screen_time_minutes", actualMinutes));
        }

        // 4. 알림 인터페이스 호출 — GROMO-805: 클라 신뢰 대신 서버 판정값을 전달한다.
        notificationPort.notify(userId, goalAchieved);
    }

    /**
     * reportedAt(Instant)을 유저 country_code 파생 ZoneId 기준 로컬 날짜로 환산한다.
     * country_code 가 null·미지원이면 UTC 로 폴백한다(CountryZoneResolver).
     */
    private LocalDate resolveLocalDate(User user, ScreenTimeRequest request) {
        ZoneId zone = CountryZoneResolver.resolve(user.getCountryCode());
        return request.getReportedAt().atZone(zone).toLocalDate();
    }
}

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

import java.time.Instant;
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

        // 3. 최종 보고 여부 판정 (GROMO-805 후속, Codex P1~P3 일괄 해소)
        //    최종 보고 = 명시적 isFinal=true 이거나, 과거 날짜 보고(마감 업로드는 다음 날 올라온다).
        //    앱이 아직 isFinal 을 안 실어 보내도(구버전) 과거 날짜면 마감으로 간주해 알림이 눌리지 않도록 서버에서 finality 를 추론한다.
        ZoneId zone = CountryZoneResolver.resolve(user.getCountryCode());
        LocalDate today = Instant.now().atZone(zone).toLocalDate(); // reportedAt 파생 date 와 같은 유저 존 기준
        boolean finalReport = Boolean.TRUE.equals(request.getIsFinal()) || date.isBefore(today);

        // 4. 목표 달성 flag 판정 (is_screen_time_goal_achieved 저장값)
        int actualMinutes = request.getActualScreenTimeMinutes() != null
                ? request.getActualScreenTimeMinutes() : 0;
        int goal = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::getDailyScreenTimeGoalMinutes).orElse(0);
        boolean achieved;
        if (finalReport) {
            // 최종 보고(명시 isFinal 또는 과거 날짜)는 클라가 '당시' 목표·하루 전체 데이터로 계산한 달성 결과를 신뢰한다.
            // 서버는 과거 날짜의 목표를 알 수 없어(현재 목표만 조회 가능) 과거 마감을 서버가 재판정하면 오귀속된다.
            achieved = Boolean.TRUE.equals(request.getScreenTimeGoalAchieved());
        } else {
            // interim(오늘, 아직 미마감)은 서버가 임시 판정한다: goal>0 & actual<=goal.
            // 단, 측정 데이터 누락(actualScreenTimeMinutes null)은 달성으로 세면 안 된다(null-data 가드, Codex #2).
            achieved = request.getActualScreenTimeMinutes() != null && goal > 0 && actualMinutes <= goal;
        }

        // 5. daily_screen_time_stats upsert (user, date) 기준 — 멱등. 저장 flag 는 매 동기화마다 판정값으로 갱신(805 조회 일관성).
        Optional<DailyScreenTimeStat> existing =
                dailyScreenTimeStatRepository.findByUserAndDate(user, date);
        if (existing.isPresent()) {
            DailyScreenTimeStat stat = existing.get();
            stat.setTotalScreenTimeMinutes(actualMinutes);
            stat.setScreenTimeGoalAchieved(achieved);
        } else {
            dailyScreenTimeStatRepository.save(DailyScreenTimeStat.builder()
                    .user(user)
                    .date(date)
                    .totalScreenTimeMinutes(actualMinutes)
                    .isScreenTimeGoalAchieved(achieved)
                    .build());
        }

        // 6. 목표 달성 알림(GROMO-395) — '최종 보고 & 달성'일 때만 이벤트+알림을 발사한다(interim 조기 알림 없음).
        //    interim(오늘) 동기화는 부분 합계가 goal 이내여도 이후 한도 초과가 가능하므로 알림을 미룬다(이벤트는 회수 불가).
        //    최종 보고는 하루 1회이므로 이 게이트가 종전 false→true 전이 dedup 역할까지 대체한다.
        //    (최종 보고 재시도로 인한 중복 발사는 희귀 케이스로 수용한다.)
        if (finalReport && achieved) {
            userActivityEventLogger.log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED, Map.of(
                    "date", date.toString(),
                    "actual_screen_time_minutes", actualMinutes));
            notificationPort.notify(userId, true);
        }
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

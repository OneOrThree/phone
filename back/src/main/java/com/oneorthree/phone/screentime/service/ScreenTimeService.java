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
        // 저장 flag 는 중간·최종 구분 없이 매 동기화마다 서버 판정값으로 갱신한다(GROMO-805 조회 일관성). 저장 로직은 변경하지 않는다.
        Optional<DailyScreenTimeStat> existing =
                dailyScreenTimeStatRepository.findByUserAndDate(user, date);
        if (existing.isPresent()) {
            DailyScreenTimeStat stat = existing.get();
            stat.setTotalScreenTimeMinutes(actualMinutes);
            stat.setScreenTimeGoalAchieved(goalAchieved);
        } else {
            dailyScreenTimeStatRepository.save(DailyScreenTimeStat.builder()
                    .user(user)
                    .date(date)
                    .totalScreenTimeMinutes(actualMinutes)
                    .isScreenTimeGoalAchieved(goalAchieved)
                    .build());
        }

        // 4. 목표 달성 알림(GROMO-395) — '최종 보고(isFinal=true) & 서버 판정 달성'일 때만 이벤트+알림을 발사한다.
        //    GROMO-805 후속(Codex P1): 앱은 하루 중 여러 번 중간 동기화를 보내는데, 아직 한도를 넘지 않은 부분 합계가
        //    goal 이내라는 이유로 조기에 알림이 나가고(이벤트는 회수 불가) 이후 한도를 초과해도 되돌릴 수 없었다.
        //    → 중간 동기화(isFinal false/null)는 저장 total+flag 만 갱신하고 이벤트·알림은 발사하지 않는다(조기 알림 방지).
        //    isFinal 부재(구버전 앱)는 이벤트 미발사로 처리한다 — 앱이 최종 보고에 isFinal=true 를 실어 보내도록 업데이트 필요(프론트 조율).
        //    최종 보고는 하루 1회이므로 이 게이트가 종전 false→true 전이 dedup 역할까지 대체한다.
        //    (최종 보고 재시도로 인한 중복 발사는 희귀 케이스로 수용한다.)
        boolean finalReport = Boolean.TRUE.equals(request.getIsFinal());
        if (finalReport && goalAchieved) {
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

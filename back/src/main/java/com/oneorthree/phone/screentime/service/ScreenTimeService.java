package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
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
    private final ScreenTimeNotificationPort notificationPort;
    private final UserActivityEventLogger userActivityEventLogger;

    @Transactional
    public void saveScreenTime(UUID userId, ScreenTimeRequest request) {
        // 1. 유저 조회
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 2. reportedAt → 유저 country_code 파생 ZoneId 기준 로컬 날짜 환산 (자정 경계 오귀속 방지)
        LocalDate date = resolveLocalDate(user, request);

        // 3. 최종 보고 여부 판정 (GROMO-805 후속). 최종 보고 = 명시적 isFinal=true 이거나 과거 날짜 보고(마감은 다음 날 업로드).
        //    앱이 아직 isFinal 을 안 보내도(구버전) 과거 날짜면 마감으로 간주해 알림이 눌리지 않도록 서버가 finality 를 추론한다.
        ZoneId zone = CountryZoneResolver.resolve(user.getCountryCode());
        LocalDate today = Instant.now().atZone(zone).toLocalDate();
        boolean finalReport = Boolean.TRUE.equals(request.getIsFinal()) || date.isBefore(today);

        // 4. 총 스크린타임(측정 데이터 누락 null → 0) + 클라 달성 결과.
        int actualMinutes = request.getActualScreenTimeMinutes() != null
                ? request.getActualScreenTimeMinutes() : 0;
        boolean clientAchieved = Boolean.TRUE.equals(request.getScreenTimeGoalAchieved());

        // 5. daily_screen_time_stats upsert (user, date) — 멱등.
        //    - interim(오늘, 미마감): total 만 갱신, 달성 flag 는 건드리지 않는다(신규 row 기본값 false, 기존 row flag 보존).
        //      "오늘"은 마감 전까지 달성으로 확정하지 않는다(805 이전 "오늘 미집계"와 동일). 마감만이 달성을 확정한다.
        //    - final(마감): is_screen_time_goal_achieved = 클라 달성 결과(client-trust). 서버는 과거 날짜의 당시 목표를
        //      알 수 없어(현재 목표만 조회 가능) 재판정하면 오귀속되므로 클라를 신뢰한다.
        Optional<DailyScreenTimeStat> existing =
                dailyScreenTimeStatRepository.findByUserAndDate(user, date);
        // 알림 전이 판정을 위해 upsert 로 flag 를 덮기 전의 기존 값을 미리 읽어 둔다.
        boolean wasAchieved = existing.isPresent() && existing.get().isScreenTimeGoalAchieved();
        if (existing.isPresent()) {
            DailyScreenTimeStat stat = existing.get();
            stat.setTotalScreenTimeMinutes(actualMinutes);
            if (finalReport) {
                stat.setScreenTimeGoalAchieved(clientAchieved);
            }
        } else {
            DailyScreenTimeStat.DailyScreenTimeStatBuilder builder = DailyScreenTimeStat.builder()
                    .user(user)
                    .date(date)
                    .totalScreenTimeMinutes(actualMinutes);
            if (finalReport) {
                builder.isScreenTimeGoalAchieved(clientAchieved);
            }
            dailyScreenTimeStatRepository.save(builder.build());
        }

        // 6. 목표 달성 알림(GROMO-395) — '최종 보고로 false→true 전이'일 때만 이벤트+알림을 1회 발사한다.
        //    interim 은 flag 를 true 로 세우지 않으므로 첫 마감은 항상 wasAchieved=false 를 보고 발사한다.
        //    마감 재시도(네이티브 읽기 미완료 시 앱이 재업로드)는 이미 true 인 flag 를 만나 재발사하지 않는다(날짜별 멱등, Codex P2).
        if (finalReport && clientAchieved && !wasAchieved) {
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

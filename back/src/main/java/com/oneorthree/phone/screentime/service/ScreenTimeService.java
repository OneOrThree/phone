package com.oneorthree.phone.screentime.service;

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

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ScreenTimeService {

    private final UserRepository userRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final ScreenTimeNotificationPort notificationPort;

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

        Optional<DailyScreenTimeStat> existing =
                dailyScreenTimeStatRepository.findByUserAndDate(user, date);
        if (existing.isPresent()) {
            DailyScreenTimeStat stat = existing.get();
            stat.setActualScreenTimeMinutes(actualMinutes);
            stat.setScreenTimeGoalAchieved(request.getScreenTimeGoalAchieved());
        } else {
            dailyScreenTimeStatRepository.save(DailyScreenTimeStat.builder()
                    .user(user)
                    .date(date)
                    .actualScreenTimeMinutes(actualMinutes)
                    .screenTimeGoalAchieved(request.getScreenTimeGoalAchieved())
                    .build());
        }

        // 4. 알림 인터페이스 호출 (달성 여부는 클라이언트 계산값을 그대로 신뢰)
        notificationPort.notify(userId, request.getScreenTimeGoalAchieved());
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

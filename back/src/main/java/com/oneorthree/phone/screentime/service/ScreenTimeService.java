package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.focus.domain.DailyFocusStat;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ScreenTimeService {

    private final UserRepository userRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final ScreenTimeNotificationPort notificationPort;

    @Transactional
    public void saveScreenTime(UUID userId, ScreenTimeRequest request) {
        // 1. 유저 조회
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));


        // 2. reportedAt → UTC 기준 LocalDate 환산 (GroupService 조회와 일관성 유지)
        LocalDate date = request.getReportedAt()
                .atZone(ZoneOffset.UTC)
                .toLocalDate();

        // 3. daily_focus_stats upsert (user, date) 기준
        int actualMinutes = request.getActualScreenTimeMinutes() != null
                ? request.getActualScreenTimeMinutes() : 0;

        Optional<DailyFocusStat> byUserAndDate = dailyFocusStatRepository.findByUserAndDate(user, date);
        if (byUserAndDate.isPresent()) {
            DailyFocusStat stat = byUserAndDate.get();
            stat.setScreenTimeGoalAchieved(request.getScreenTimeGoalAchieved());
            stat.setActualScreenTimeMinutes(actualMinutes);
        } else {
            dailyFocusStatRepository.save(DailyFocusStat.builder()
                    .user(user)
                    .date(date)
                    .actualScreenTimeMinutes(actualMinutes)
                    .screenTimeGoalAchieved(request.getScreenTimeGoalAchieved())
                    .build());
        }

        // 4. 알림 인터페이스 호출
        notificationPort.notify(userId, request.getScreenTimeGoalAchieved());
    }
}

package com.oneorthree.phone.service;

import com.oneorthree.phone.focus.domain.DailyFocusStat;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.exception.UserNotFoundException;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.service.dto.screentime.ScreenTimeRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class ScreenTimeService {

    private final UserRepository userRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final ScreenTimeNotificationPort notificationPort;

    @Transactional
    public void saveScreenTime(Long userId, ScreenTimeRequest request) {
        // 1. 유저 조회
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);


        // 2. reportedAt + timeZone → LocalDate 환산
        LocalDate date = request.getReportedAt()
                .atZone(ZoneId.of(request.getTimeZone()))
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

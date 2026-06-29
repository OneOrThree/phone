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
    // TODO GROMO-551: 의존성을 DailyFocusStatRepository → DailyScreenTimeStatRepository 로 교체
    //   (스크린타임 집계가 daily_screen_time_stats 로 분리됨. focus 리포지토리는 이 서비스에서 더 이상 불필요).

    @Transactional
    public void saveScreenTime(UUID userId, ScreenTimeRequest request) {
        // 1. 유저 조회
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));


        // 2. reportedAt → UTC 기준 LocalDate 환산 (GroupService 조회와 일관성 유지)
        // TODO GROMO-551: UTC 고정 → 요청 timeZone 기준 로컬 날짜로 교정
        //   date = request.getReportedAt().atZone(ZoneId.of(request.getTimeZone())).toLocalDate()
        //   무효 timeZone → 400 (ZoneId.of 의 ZoneRulesException 은 GlobalExceptionHandler 에서 이미 400 매핑;
        //   포맷 깨짐 DateTimeException 도 400 으로 떨어지도록 필요 시 핸들러 보강).
        //   ZoneOffset import 는 제거, ZoneId import 추가.
        LocalDate date = request.getReportedAt()
                .atZone(ZoneOffset.UTC)
                .toLocalDate();

        // 3. daily_focus_stats upsert (user, date) 기준
        // TODO GROMO-551: upsert 대상을 DailyScreenTimeStat 로 변경 (dailyScreenTimeStatRepository.findByUserAndDate)
        //   - 빌더/세터 필드: actualScreenTimeMinutes(null→0), screenTimeGoalAchieved(클라 값 그대로 신뢰 — 서버 재계산 안 함)
        //   - 멱등 upsert 유지, notificationPort.notify(...) 호출은 그대로.
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

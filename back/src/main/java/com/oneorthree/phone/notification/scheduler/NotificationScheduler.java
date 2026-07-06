package com.oneorthree.phone.notification.scheduler;

import com.oneorthree.phone.notification.service.InactiveReturnNotificationService;
import com.oneorthree.phone.notification.service.LeagueNotificationService;
import com.oneorthree.phone.notification.service.RankOvertakeNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 알림 스케줄 트리거 (GROMO-528) — 트리거와 로직 분리(LeagueScheduler 선례).
 * @EnableScheduling 은 common/config/SchedulingConfig 에 기존재(412).
 * 578(미접속 복귀)·579(순위 추월) 집결 완료.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NotificationScheduler {

    private final LeagueNotificationService leagueNotificationService;
    private final InactiveReturnNotificationService inactiveReturnNotificationService;
    private final RankOvertakeNotificationService rankOvertakeNotificationService;

    // 승격/강등 알림 — 주간 배치(월 00시 마감, 412) 후 quiet hours 가 끝나는 09시에 발송
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (티켓 565) — LeagueScheduler 와 동일
    @Scheduled(cron = "0 0 9 * * MON", zone = "Asia/Seoul")
    public void sendWeeklyResultNotifications() {
        try {
            leagueNotificationService.sendWeeklyResultNotifications();
        } catch (Exception e) {
            // 실패가 같은 시각 다른 스케줄/다음 주기에 전파되지 않게 격리 — 해당 주 알림은 유실 허용(로그 감시)
            log.error("주간 리그 결과 알림 스케줄 실패", e);
        }
    }

    // 마감 임박 알림 — 마감(월 00시 KST) 4시간 전, 기본 quiet hours(21시) 진입 직전
    @Scheduled(cron = "0 0 20 * * SUN", zone = "Asia/Seoul")
    public void sendDeadlineReminders() {
        try {
            leagueNotificationService.sendDeadlineReminders();
        } catch (Exception e) {
            log.error("리그 마감 임박 알림 스케줄 실패", e);
        }
    }

    // 미접속 복귀 푸시 (GROMO-578) — 매일 10:00 KST. quiet hours(기본 21–09) 종료 후 오전 리텐션 골든타임.
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (티켓 565) — 리그 스케줄과 동일
    @Scheduled(cron = "0 0 10 * * *", zone = "Asia/Seoul")
    public void sendInactiveReturnNotifications() {
        try {
            inactiveReturnNotificationService.sendInactiveReturnNotifications();
        } catch (Exception e) {
            log.error("미접속 복귀 푸시 스케줄 실패", e);
        }
    }

    // 순위 추월 푸시 (GROMO-579) — 매일 19:00 KST. 저녁이라 반응 여유 + 야간(기본 21시) 차단 전이라 그날 만회 가능.
    // 어제 스냅샷과 오늘 실시간 순위를 비교해 나를 제친 라이벌 1건 묶음 발송, 처리 후 오늘 스냅샷 저장.
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (티켓 565) — 리그 스케줄과 동일
    @Scheduled(cron = "0 0 19 * * *", zone = "Asia/Seoul")
    public void sendRankOvertakeNotifications() {
        try {
            rankOvertakeNotificationService.sendRankOvertakeNotifications();
        } catch (Exception e) {
            log.error("순위 추월 푸시 스케줄 실패", e);
        }
    }
}

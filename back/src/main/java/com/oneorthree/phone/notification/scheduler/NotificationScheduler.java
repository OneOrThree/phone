package com.oneorthree.phone.notification.scheduler;

import com.oneorthree.phone.group.service.GroupBetFreezeMonitor;
import com.oneorthree.phone.notification.service.BetResultNotificationService;
import com.oneorthree.phone.notification.service.ChallengeDurationEndNotificationService;
import com.oneorthree.phone.notification.service.ChallengeWindowEndNotificationService;
import com.oneorthree.phone.notification.service.InactiveReturnNotificationService;
import com.oneorthree.phone.notification.service.LeagueNotificationService;
import com.oneorthree.phone.notification.service.LeagueReengagementNotificationService;
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
    private final LeagueReengagementNotificationService leagueReengagementNotificationService;
    private final BetResultNotificationService betResultNotificationService;
    private final ChallengeWindowEndNotificationService challengeWindowEndNotificationService;
    private final ChallengeDurationEndNotificationService challengeDurationEndNotificationService;
    private final GroupBetFreezeMonitor groupBetFreezeMonitor;

    // 주간 결과 알림 — 정산 배치(월 00시)와 유저 발표를 분리해 월 07시 발송 — 조용한 시간(기본 23–07) 종료 시각과 정합
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (티켓 565) — LeagueScheduler 와 동일
    @Scheduled(cron = "0 0 7 * * MON", zone = "Asia/Seoul")
    public void sendWeeklyResultNotifications() {
        try {
            leagueNotificationService.sendWeeklyResultNotifications();
        } catch (Exception e) {
            // 실패가 같은 시각 다른 스케줄/다음 주기에 전파되지 않게 격리 — 해당 주 알림은 유실 허용(로그 감시)
            log.error("주간 리그 결과 알림 스케줄 실패", e);
        }
    }

    // 마감 임박 알림 — 마감(월 00시 KST) 4시간 전(일 20시). 조용한 시간(기본 23시) 진입 전
    @Scheduled(cron = "0 0 20 * * SUN", zone = "Asia/Seoul")
    public void sendDeadlineReminders() {
        try {
            leagueNotificationService.sendDeadlineReminders();
        } catch (Exception e) {
            log.error("리그 마감 임박 알림 스케줄 실패", e);
        }
    }

    // 강등 경고 + 마감 D-1 (GROMO-840) — 마감 하루 전 일요일 오전. 유저당 1건 분기(강등 경고 > 마감 D-1 > 무발송)
    @Scheduled(cron = "0 0 9 * * SUN", zone = "Asia/Seoul")
    public void sendSundayCrisisReminders() {
        try {
            leagueNotificationService.sendSundayCrisisReminders();
        } catch (Exception e) {
            log.error("일요일 위기 알림(강등 경고·마감 D-1) 스케줄 실패", e);
        }
    }

    // 강등 경고 재발송 (GROMO-840) — 일요일 저녁(18시), 강등 위험군만 손실회피 강화
    @Scheduled(cron = "0 0 18 * * SUN", zone = "Asia/Seoul")
    public void sendRelegationWarnings() {
        try {
            leagueNotificationService.sendRelegationWarnings();
        } catch (Exception e) {
            log.error("일요일 저녁 강등 경고 재발송 스케줄 실패", e);
        }
    }

    // 마감 2시간 전 알림 (GROMO-840) — 마감(월 00시 KST) 2시간 전(일 22시). 진행 중 전원 마지막 스퍼트
    @Scheduled(cron = "0 0 22 * * SUN", zone = "Asia/Seoul")
    public void sendFinalDeadlineReminders() {
        try {
            leagueNotificationService.sendFinalDeadlineReminders();
        } catch (Exception e) {
            log.error("리그 마감 2시간 전 알림 스케줄 실패", e);
        }
    }

    // 미접속 복귀 푸시 (GROMO-578) — 매일 10:00 KST. 조용한 시간(기본 23–07) 종료 후 오전 리텐션 골든타임.
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (티켓 565) — 리그 스케줄과 동일
    @Scheduled(cron = "0 0 10 * * *", zone = "Asia/Seoul")
    public void sendInactiveReturnNotifications() {
        try {
            inactiveReturnNotificationService.sendInactiveReturnNotifications();
        } catch (Exception e) {
            log.error("미접속 복귀 푸시 스케줄 실패", e);
        }
    }

    // 순위 추월 푸시 (GROMO-579) — 매일 19:00 KST. 저녁이라 반응 여유 + 야간(기본 23시) 차단 전이라 그날 만회 가능.
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

    // 오늘 미집중 푸시 (GROMO-841) — 평일 21:00 KST. 이번 주 참여했으나 오늘 0분인 유저 리텐션
    @Scheduled(cron = "0 0 21 * * MON-FRI", zone = "Asia/Seoul")
    public void sendMissedFocusToday() {
        try {
            leagueReengagementNotificationService.sendMissedFocusToday();
        } catch (Exception e) {
            log.error("오늘 미집중 푸시 스케줄 실패", e);
        }
    }

    // 스트릭 위기 푸시 (GROMO-841) — 출석 스트릭 끊길 위험 유저에게 마지막 독려.
    // 평일·토 22:00 KST. 일요일만 21:00 으로 오프셋 — 일 22:00 은 마감 2시간 전 푸시
    // (sendFinalDeadlineReminders)와 겹쳐 focus 넛지가 중복되므로, 겹치지 않는 21시로 분리(일요일도 스트릭 발송 유지).
    @Scheduled(cron = "0 0 22 * * MON-SAT", zone = "Asia/Seoul")
    @Scheduled(cron = "0 0 21 * * SUN", zone = "Asia/Seoul")
    public void sendStreakAtRisk() {
        try {
            leagueReengagementNotificationService.sendStreakAtRisk();
        } catch (Exception e) {
            log.error("스트릭 위기 푸시 스케줄 실패", e);
        }
    }

    // 내기 정산 결과 푸시 (B4) — 08:00 · 13:00 KST 2회. 정산은 01:00(FOCUS)·12:00(SCREEN_TIME)에
    // 도는데 01:00 은 조용한 시간(기본 23–07) 한복판이라 발송을 08:00 으로 미루고, 13:00 이 12:00
    // 정산분을 잇는다. 같은 정산분을 두 번 훑어도 sent_log dedup 때문에 이중 발송은 없다.
    @Scheduled(cron = "0 0 8 * * *", zone = "Asia/Seoul")
    @Scheduled(cron = "0 0 13 * * *", zone = "Asia/Seoul")
    public void sendBetResultNotifications() {
        try {
            betResultNotificationService.sendBetResultNotifications();
        } catch (Exception e) {
            log.error("내기 정산 결과 푸시 스케줄 실패", e);
        }
    }

    // 창형 챌린지 창 종료 푸시 (B4, GROMO-1088 에서 FOCUS 창형까지 확대) — 15분 간격. 창이 끝난 직후
    // 복귀를 유도해야 그 진입이 창 사용분 업로드를 트리거하므로(A4) 시각 고정 크론으로는 못 잡는다.
    // 심야 창은 조용한 시간 필터에서 스킵되는 것을 수용한다(계약 §2).
    @Scheduled(cron = "0 */15 * * * *", zone = "Asia/Seoul")
    public void sendChallengeWindowEndNotifications() {
        try {
            challengeWindowEndNotificationService.sendWindowEndNotifications();
        } catch (Exception e) {
            log.error("챌린지 창 종료 푸시 스케줄 실패", e);
        }
    }

    // 일 목표형(DURATION) 챌린지 하루 마감 푸시 (GROMO-1088) — 매일 09:00 KST. 회차는 자정에 끝나지만
    // 그 시각은 조용한 시간(기본 23–07) 한복판이고 08:00 은 내기 결과 푸시가 이미 쓴다. 09:00 은
    // 스크린타임 내기 정산(12:00)보다 앞서 어제치 업로드가 정산 전에 반영되는 이점도 있다.
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (티켓 565) — 다른 알림 스케줄과 같은 한계
    @Scheduled(cron = "0 0 9 * * *", zone = "Asia/Seoul")
    public void sendChallengeDurationEndNotifications() {
        try {
            challengeDurationEndNotificationService.sendDurationEndNotifications();
        } catch (Exception e) {
            log.error("일 목표 챌린지 마감 푸시 스케줄 실패", e);
        }
    }

    // 판돈 동결 감지 (B4 ops) — 09:00 KST. 정산 배치가 조용히 죽으면 에스크로된 판돈이 묶인 채
    // 아무 로그도 남지 않는다. 유저 발송이 아니라 운영 로그지만, 크론 트리거를 한곳에 모으는 이 파일의
    // 역할(트리거/로직 분리)에 맞춰 여기에 둔다 — 로직은 group 도메인의 GroupBetFreezeMonitor 소유.
    @Scheduled(cron = "0 0 9 * * *", zone = "Asia/Seoul")
    public void detectFrozenBets() {
        try {
            groupBetFreezeMonitor.detectFrozenBets();
        } catch (Exception e) {
            log.error("판돈 동결 감지 스케줄 실패", e);
        }
    }
}

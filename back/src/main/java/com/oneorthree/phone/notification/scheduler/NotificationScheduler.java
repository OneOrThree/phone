package com.oneorthree.phone.notification.scheduler;

import com.oneorthree.phone.group.service.GroupBetFreezeMonitor;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import com.oneorthree.phone.notification.service.ChallengeDurationEndNotificationService;
import com.oneorthree.phone.notification.service.ChallengeWindowEndNotificationService;
import com.oneorthree.phone.notification.service.InactiveReturnNotificationService;
import com.oneorthree.phone.notification.service.LeagueNotificationService;
import com.oneorthree.phone.notification.service.LeagueReengagementNotificationService;
import com.oneorthree.phone.notification.service.RankOvertakeNotificationService;
import com.oneorthree.phone.notification.service.SessionOpenNotificationService;
import com.oneorthree.phone.notification.service.SilentFlushPushService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 알림 스케줄 트리거 (GROMO-528) — 트리거와 로직 분리(LeagueScheduler 선례).
 * @EnableScheduling 은 common/config/SchedulingConfig 에 기존재(412).
 * 578(미접속 복귀)·579(순위 추월) 집결 완료.
 *
 * <p>멀티 인스턴스 중복 실행은 ShedLock 이 막는다(GROMO-1283, policy §E4) — 크론마다
 * {@code @SchedulerLock} 고유 이름, 상한은 기본 10분(common/config/ShedLockConfig).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NotificationScheduler {

    private final LeagueNotificationService leagueNotificationService;
    private final InactiveReturnNotificationService inactiveReturnNotificationService;
    private final RankOvertakeNotificationService rankOvertakeNotificationService;
    private final LeagueReengagementNotificationService leagueReengagementNotificationService;
    private final BetEventNotificationService betEventNotificationService;
    private final SessionOpenNotificationService sessionOpenNotificationService;
    private final SilentFlushPushService silentFlushPushService;
    private final ChallengeWindowEndNotificationService challengeWindowEndNotificationService;
    private final ChallengeDurationEndNotificationService challengeDurationEndNotificationService;
    private final GroupBetFreezeMonitor groupBetFreezeMonitor;

    // 주간 결과 알림 — 정산 배치(월 00시)와 유저 발표를 분리해 월 07시 발송 — 조용한 시간(기본 23–07) 종료 시각과 정합
    @Scheduled(cron = "0 0 7 * * MON", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-weekly-results")
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
    @SchedulerLock(name = "notification-league-deadline")
    public void sendDeadlineReminders() {
        try {
            leagueNotificationService.sendDeadlineReminders();
        } catch (Exception e) {
            log.error("리그 마감 임박 알림 스케줄 실패", e);
        }
    }

    // 강등 경고 + 마감 D-1 (GROMO-840) — 마감 하루 전 일요일 오전. 유저당 1건 분기(강등 경고 > 마감 D-1 > 무발송)
    @Scheduled(cron = "0 0 9 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-sunday-crisis")
    public void sendSundayCrisisReminders() {
        try {
            leagueNotificationService.sendSundayCrisisReminders();
        } catch (Exception e) {
            log.error("일요일 위기 알림(강등 경고·마감 D-1) 스케줄 실패", e);
        }
    }

    // 강등 경고 재발송 (GROMO-840) — 일요일 저녁(18시), 강등 위험군만 손실회피 강화
    @Scheduled(cron = "0 0 18 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-relegation-warning")
    public void sendRelegationWarnings() {
        try {
            leagueNotificationService.sendRelegationWarnings();
        } catch (Exception e) {
            log.error("일요일 저녁 강등 경고 재발송 스케줄 실패", e);
        }
    }

    // 마감 2시간 전 알림 (GROMO-840) — 마감(월 00시 KST) 2시간 전(일 22시). 진행 중 전원 마지막 스퍼트
    @Scheduled(cron = "0 0 22 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-final-deadline")
    public void sendFinalDeadlineReminders() {
        try {
            leagueNotificationService.sendFinalDeadlineReminders();
        } catch (Exception e) {
            log.error("리그 마감 2시간 전 알림 스케줄 실패", e);
        }
    }

    // 미접속 복귀 푸시 (GROMO-578) — 매일 10:00 KST. 조용한 시간(기본 23–07) 종료 후 오전 리텐션 골든타임.
    @Scheduled(cron = "0 0 10 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-inactive-return")
    public void sendInactiveReturnNotifications() {
        try {
            inactiveReturnNotificationService.sendInactiveReturnNotifications();
        } catch (Exception e) {
            log.error("미접속 복귀 푸시 스케줄 실패", e);
        }
    }

    // 순위 추월 푸시 (GROMO-579) — 매일 19:00 KST. 저녁이라 반응 여유 + 야간(기본 23시) 차단 전이라 그날 만회 가능.
    // 어제 스냅샷과 오늘 실시간 순위를 비교해 나를 제친 라이벌 1건 묶음 발송, 처리 후 오늘 스냅샷 저장.
    @Scheduled(cron = "0 0 19 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-rank-overtake")
    public void sendRankOvertakeNotifications() {
        try {
            rankOvertakeNotificationService.sendRankOvertakeNotifications();
        } catch (Exception e) {
            log.error("순위 추월 푸시 스케줄 실패", e);
        }
    }

    // 오늘 미집중 푸시 (GROMO-841) — 평일 21:00 KST. 이번 주 참여했으나 오늘 0분인 유저 리텐션
    @Scheduled(cron = "0 0 21 * * MON-FRI", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-missed-focus-today")
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
    @SchedulerLock(name = "notification-streak-at-risk")
    public void sendStreakAtRisk() {
        try {
            leagueReengagementNotificationService.sendStreakAtRisk();
        } catch (Exception e) {
            log.error("스트릭 위기 푸시 스케줄 실패", e);
        }
    }

    // 내기 사건 알림 재훑기 + 이월 flush (GROMO-1417) — 15분 간격. 주 발송 경로는 정산·환불 커밋
    // 직후의 이벤트(AFTER_COMMIT 리스너)라 즉시성이 있고, 이 크론은 이벤트 유실·발송 실패·죽은
    // 워커의 리스 만료 건을 최근 48시간 재훑기로 회수하는 안전망이다. 선점 dedup(N41)이라 이벤트
    // 경로와 겹쳐 돌아도 이중 발송이 없다. 07:00 정각 틱이 조용한 시간 이월분(N44)을 흘려보낸다.
    @Scheduled(cron = "0 */15 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-bet-event-rescan")
    public void rescanBetEventNotifications() {
        try {
            betEventNotificationService.rescanAndFlush();
        } catch (Exception e) {
            log.error("내기 사건 알림 재훑기 스케줄 실패", e);
        }
    }

    // 회차 참여 모집 푸시 (GROMO-1417, N40·N20) — 15분 간격. 슬롯이 회차 유형으로 갈린다:
    // 창형은 참가 마감(창 시작) −30분, 하루형은 당일 08:00 KST. 하루형의 시작−30분(전날 23:30)은
    // 회차 미생성(00:05 개설) + 조용한 시간에 이중으로 막혀 영영 못 나가기 때문이다. 조용한 시간에
    // 걸린 모집은 이월하지 않고 버린다(N44 단서 — 07:00 도착은 이미 마감 뒤라 거짓말이 된다).
    @Scheduled(cron = "0 */15 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-session-open")
    public void sendSessionOpenNotifications() {
        try {
            sessionOpenNotificationService.sendSessionOpenNotifications();
        } catch (Exception e) {
            log.error("회차 모집 푸시 스케줄 실패", e);
        }
    }

    // 사일런트 flush 푸시 (GROMO-1281, FR-22) — 5분 간격. 발송 시점은 settle_after - 15분
    // (HLD §6 시각 표)이라 마지막 15분 버킷까지 판정에 반영된다. 5분 크론이 그 15분 창을 3틱
    // 훑지만 회차당 1회는 사건 클레임이 보장한다. 표시가 아니라 조용한 시간 필터를 타지 않는다
    // (HLD §6 예외 - FOCUS 하루형의 심야 정산이 이 예외로 구제된다).
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-silent-flush")
    public void sendSilentFlushPushes() {
        try {
            silentFlushPushService.sendGraceFlushPushes();
        } catch (Exception e) {
            log.error("사일런트 flush 푸시 스케줄 실패", e);
        }
    }

    // 창형 챌린지 창 종료 푸시 (B4, GROMO-1088 에서 FOCUS 창형까지 확대) — 15분 간격. 창이 끝난 직후
    // 복귀를 유도해야 그 진입이 창 사용분 업로드를 트리거하므로(A4) 시각 고정 크론으로는 못 잡는다.
    // 심야 창은 조용한 시간 필터에서 스킵되는 것을 수용한다(계약 §2).
    @Scheduled(cron = "0 */15 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-challenge-window-end")
    public void sendChallengeWindowEndNotifications() {
        try {
            challengeWindowEndNotificationService.sendWindowEndNotifications();
        } catch (Exception e) {
            log.error("챌린지 창 종료 푸시 스케줄 실패", e);
        }
    }

    // 일 목표형(DURATION) 챌린지 하루 마감 푸시 (GROMO-1088) — 매일 09:00 KST. 회차는 자정에 끝나지만
    // 그 시각은 조용한 시간(기본 23–07) 한복판이고 08:00 대신 09:00 — 스크린타임 내기 정산(12:00)보다
    // 앞서 어제치 업로드가 정산 전에 반영되는 이점도 있다.
    @Scheduled(cron = "0 0 9 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-challenge-duration-end")
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
    @SchedulerLock(name = "group-bet-freeze-monitor")
    public void detectFrozenBets() {
        try {
            groupBetFreezeMonitor.detectFrozenBets();
        } catch (Exception e) {
            log.error("판돈 동결 감지 스케줄 실패", e);
        }
    }
}

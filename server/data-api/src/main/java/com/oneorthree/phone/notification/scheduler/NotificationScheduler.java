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
 * {@code @EnableScheduling} 은 common/config/SchedulingConfig 에 기존재(412).
 * 578(미접속 복귀)·579(순위 추월) 집결 완료.
 *
 * <p>멀티 인스턴스 중복 실행은 ShedLock 이 막는다(GROMO-1283, policy §E4) — 크론마다
 * {@code @SchedulerLock} 고유 이름, 상한은 기본 10분(common/config/ShedLockConfig).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NotificationScheduler {

    /**
     * 팬아웃 발송 크론의 락 상한 — 기본 10분(ShedLockConfig)보다 훨씬 길게 잡는다.
     *
     * <p>대상 유저마다 FCM blocking 호출이 순차로 나가므로 최악 실행시간은
     * (연결 5s + 읽기 10s) × 대상 수까지 늘어난다({@code FcmPushNotificationClient} 타임아웃).
     * 상한이 실행시간보다 짧으면 락이 <b>실행 중에</b> 만료돼 다른 인스턴스가 같은 크론을 시작하고,
     * dedup 이 없는 발송(미접속 복귀 등)은 그대로 같은 유저에게 중복 푸시가 된다 — 스톨보다 나쁘다.
     * 1시간이면 타임아웃 상한 기준 240건을 덮고, 그보다 오래 걸리는 상황은 이미 장애다.
     */
    static final String FANOUT_LOCK = "PT1H";

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

    /**
     * 주간 결과 알림 — 정산 배치(월 00시)와 유저 발표를 분리해 월 07시 발송 — 조용한 시간(기본 23–07) 종료 시각과 정합
     */
    @Scheduled(cron = "0 0 7 * * MON", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-weekly-results", lockAtMostFor = FANOUT_LOCK)
    public void sendWeeklyResultNotifications() {
        try {
            leagueNotificationService.sendWeeklyResultNotifications();
        } catch (Exception e) {
            // 실패가 같은 시각 다른 스케줄/다음 주기에 전파되지 않게 격리 — 해당 주 알림은 유실 허용(로그 감시)
            log.error("주간 리그 결과 알림 스케줄 실패", e);
        }
    }

    /**
     * 마감 임박 알림 — 마감(월 00시 KST) 4시간 전(일 20시). 조용한 시간(기본 23시) 진입 전
     */
    @Scheduled(cron = "0 0 20 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-deadline", lockAtMostFor = FANOUT_LOCK)
    public void sendDeadlineReminders() {
        try {
            leagueNotificationService.sendDeadlineReminders();
        } catch (Exception e) {
            log.error("리그 마감 임박 알림 스케줄 실패", e);
        }
    }

    /**
     * 강등 경고 + 마감 D-1 (GROMO-840) — 마감 하루 전 일요일 오전. 유저당 1건 분기(강등 경고 > 마감 D-1 > 무발송)
     */
    @Scheduled(cron = "0 0 9 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-sunday-crisis", lockAtMostFor = FANOUT_LOCK)
    public void sendSundayCrisisReminders() {
        try {
            leagueNotificationService.sendSundayCrisisReminders();
        } catch (Exception e) {
            log.error("일요일 위기 알림(강등 경고·마감 D-1) 스케줄 실패", e);
        }
    }

    /**
     * 강등 경고 재발송 (GROMO-840) — 일요일 저녁(18시), 강등 위험군만 손실회피 강화
     */
    @Scheduled(cron = "0 0 18 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-relegation-warning", lockAtMostFor = FANOUT_LOCK)
    public void sendRelegationWarnings() {
        try {
            leagueNotificationService.sendRelegationWarnings();
        } catch (Exception e) {
            log.error("일요일 저녁 강등 경고 재발송 스케줄 실패", e);
        }
    }

    /**
     * 마감 2시간 전 알림 (GROMO-840) — 마감(월 00시 KST) 2시간 전(일 22시). 진행 중 전원 마지막 스퍼트
     */
    @Scheduled(cron = "0 0 22 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-league-final-deadline", lockAtMostFor = FANOUT_LOCK)
    public void sendFinalDeadlineReminders() {
        try {
            leagueNotificationService.sendFinalDeadlineReminders();
        } catch (Exception e) {
            log.error("리그 마감 2시간 전 알림 스케줄 실패", e);
        }
    }

    /**
     * 미접속 복귀 푸시 (GROMO-578) — 매일 10:00 KST. 조용한 시간(기본 23–07) 종료 후 오전 리텐션 골든타임.
     */
    @Scheduled(cron = "0 0 10 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-inactive-return", lockAtMostFor = FANOUT_LOCK)
    public void sendInactiveReturnNotifications() {
        try {
            inactiveReturnNotificationService.sendInactiveReturnNotifications();
        } catch (Exception e) {
            log.error("미접속 복귀 푸시 스케줄 실패", e);
        }
    }

    /**
     * 순위 추월 푸시 (GROMO-579) — 매일 19:00 KST. 저녁이라 반응 여유 + 야간(기본 23시) 차단 전이라 그날 만회 가능.
     * 어제 스냅샷과 오늘 실시간 순위를 비교해 나를 제친 라이벌 1건 묶음 발송, 처리 후 오늘 스냅샷 저장.
     */
    @Scheduled(cron = "0 0 19 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-rank-overtake", lockAtMostFor = FANOUT_LOCK)
    public void sendRankOvertakeNotifications() {
        try {
            rankOvertakeNotificationService.sendRankOvertakeNotifications();
        } catch (Exception e) {
            log.error("순위 추월 푸시 스케줄 실패", e);
        }
    }

    /**
     * 오늘 미집중 푸시 (GROMO-841) — 평일 21:00 KST. 이번 주 참여했으나 오늘 0분인 유저 리텐션
     */
    @Scheduled(cron = "0 0 21 * * MON-FRI", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-missed-focus-today", lockAtMostFor = FANOUT_LOCK)
    public void sendMissedFocusToday() {
        try {
            leagueReengagementNotificationService.sendMissedFocusToday();
        } catch (Exception e) {
            log.error("오늘 미집중 푸시 스케줄 실패", e);
        }
    }

    /**
     * 스트릭 위기 푸시 (GROMO-841) — 출석 스트릭 끊길 위험 유저에게 마지막 독려.
     * 평일·토 22:00 KST. 일요일만 21:00 으로 오프셋 — 일 22:00 은 마감 2시간 전 푸시
     * (sendFinalDeadlineReminders)와 겹쳐 focus 넛지가 중복되므로, 겹치지 않는 21시로 분리(일요일도 스트릭 발송 유지).
     */
    @Scheduled(cron = "0 0 22 * * MON-SAT", zone = "Asia/Seoul")
    @Scheduled(cron = "0 0 21 * * SUN", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-streak-at-risk", lockAtMostFor = FANOUT_LOCK)
    public void sendStreakAtRisk() {
        try {
            leagueReengagementNotificationService.sendStreakAtRisk();
        } catch (Exception e) {
            log.error("스트릭 위기 푸시 스케줄 실패", e);
        }
    }

    /**
     * 내기 사건 알림 묶음 flush (GROMO-1417·1282) — 5분 간격. 이벤트·재훑기는 사건을 선점만 하고,
     * 실제 발송은 여기서 &lt;슬롯이 닫힌> 클레임을 (유저 × 그룹 × 슬롯)으로 묶어 한 건씩 보낸다.
     * 이벤트가 곧바로 보내면 같은 슬롯에 여러 회차가 끝날 때 회차 수만큼 푸시가 나간다(N20 파기).
     * 07:00 이후 첫 틱이 조용한 시간 이월분(N44)도 함께 흘려보낸다.
     * lockAtMostFor 를 길게 잡는다 — 대상이 많으면 FCM 순차 호출로 길어지는데, 락이 먼저 만료되면
     * 다른 인스턴스가 같은 flush 를 시작한다(선점 SKIP LOCKED 가 막지만 낭비다).
     */
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-bet-event-flush", lockAtMostFor = FANOUT_LOCK)
    public void flushBetEventNotifications() {
        try {
            betEventNotificationService.flushDueBundles();
        } catch (Exception e) {
            log.error("내기 사건 알림 묶음 flush 스케줄 실패", e);
        }
    }

    /**
     * 내기 사건 알림 재훑기 (GROMO-1417) — 15분 간격. 최근 48시간 종료 회차를 다시 훑어 이벤트
     * 유실·죽은 워커의 리스 만료 건을 &lt;선점>한다(발송은 위 flush 가 슬롯 단위로 한다).
     * 선점 dedup(N41)이라 이벤트 경로와 겹쳐 돌아도 이중 클레임이 없다.
     */
    @Scheduled(cron = "0 */15 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-bet-event-rescan", lockAtMostFor = FANOUT_LOCK)
    public void rescanBetEventNotifications() {
        try {
            betEventNotificationService.rescanAndFlush();
        } catch (Exception e) {
            log.error("내기 사건 알림 재훑기 스케줄 실패", e);
        }
    }

    /**
     * 회차 참여 모집 푸시 (GROMO-1417, N40·N20) — 15분 간격. 슬롯이 회차 유형으로 갈린다:
     * 창형은 참가 마감(창 시작) −30분, 하루형은 당일 08:00 KST. 하루형의 시작−30분(전날 23:30)은
     * 회차 미생성(00:05 개설) + 조용한 시간에 이중으로 막혀 영영 못 나가기 때문이다. 조용한 시간에
     * 걸린 모집은 참가 마감과 대조해 가른다 — 조용한 시간 종료 시점에 이미 마감이면 버리고(N44 단서
     * — 그때 도착해봐야 거짓말이다), 그때도 참가할 수 있으면 이월해 종료 시각에 보낸다(N44).
     * 이 크론이 이월분 flush 도 겸한다(별도 크론 없음).
     */
    @Scheduled(cron = "0 */15 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-session-open", lockAtMostFor = FANOUT_LOCK)
    public void sendSessionOpenNotifications() {
        try {
            sessionOpenNotificationService.sendSessionOpenNotifications();
        } catch (Exception e) {
            log.error("회차 모집 푸시 스케줄 실패", e);
        }
    }

    /**
     * 사일런트 flush 푸시 (GROMO-1281, FR-22) — 5분 간격. 발송 시점은 settle_after - 15분
     * (HLD §6 시각 표)이라 마지막 15분 버킷까지 판정에 반영된다. 5분 크론이 그 15분 창을 3틱
     * 훑지만 회차당 1회는 사건 클레임이 보장한다. 표시가 아니라 조용한 시간 필터를 타지 않는다
     * (HLD §6 예외 - FOCUS 하루형의 심야 정산이 이 예외로 구제된다).
     */
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-silent-flush", lockAtMostFor = FANOUT_LOCK)
    public void sendSilentFlushPushes() {
        try {
            silentFlushPushService.sendGraceFlushPushes();
        } catch (Exception e) {
            log.error("사일런트 flush 푸시 스케줄 실패", e);
        }
    }

    /**
     * 창형 챌린지 창 종료 푸시 (B4, GROMO-1088 에서 FOCUS 창형까지 확대) — 15분 간격. 창이 끝난 직후
     * 복귀를 유도해야 그 진입이 창 사용분 업로드를 트리거하므로(A4) 시각 고정 크론으로는 못 잡는다.
     * 심야 창은 조용한 시간 필터에서 스킵되는 것을 수용한다(계약 §2).
     */
    @Scheduled(cron = "0 */15 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-challenge-window-end", lockAtMostFor = FANOUT_LOCK)
    public void sendChallengeWindowEndNotifications() {
        try {
            challengeWindowEndNotificationService.sendWindowEndNotifications();
        } catch (Exception e) {
            log.error("챌린지 창 종료 푸시 스케줄 실패", e);
        }
    }

    /**
     * 일 목표형(DURATION) 챌린지 하루 마감 푸시 (GROMO-1088) — 매일 09:00 KST. 회차는 자정에 끝나지만
     * 그 시각은 조용한 시간(기본 23–07) 한복판이고 08:00 대신 09:00 — 스크린타임 내기 정산(12:00)보다
     * 앞서 어제치 업로드가 정산 전에 반영되는 이점도 있다.
     */
    @Scheduled(cron = "0 0 9 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "notification-challenge-duration-end", lockAtMostFor = FANOUT_LOCK)
    public void sendChallengeDurationEndNotifications() {
        try {
            challengeDurationEndNotificationService.sendDurationEndNotifications();
        } catch (Exception e) {
            log.error("일 목표 챌린지 마감 푸시 스케줄 실패", e);
        }
    }

    /**
     * 판돈 동결 감지 (B4 ops) — 09:00 KST. 정산 배치가 조용히 죽으면 에스크로된 판돈이 묶인 채
     * 아무 로그도 남지 않는다. 유저 발송이 아니라 운영 로그지만, 크론 트리거를 한곳에 모으는 이 파일의
     * 역할(트리거/로직 분리)에 맞춰 여기에 둔다 — 로직은 group 도메인의 GroupBetFreezeMonitor 소유.
     */
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

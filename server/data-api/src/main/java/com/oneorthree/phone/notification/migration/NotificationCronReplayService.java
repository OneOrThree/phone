package com.oneorthree.phone.notification.migration;

import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.ResultBundleCompletionService;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import com.oneorthree.phone.notification.service.ChallengeDurationEndNotificationService;
import com.oneorthree.phone.notification.service.ChallengeWindowEndNotificationService;
import com.oneorthree.phone.notification.service.InactiveReturnNotificationService;
import com.oneorthree.phone.notification.service.LeagueNotificationService;
import com.oneorthree.phone.notification.service.NotificationBatchRetry;
import com.oneorthree.phone.notification.service.LeagueReengagementNotificationService;
import com.oneorthree.phone.notification.service.SessionOpenNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;

/**
 * 놓친 Data 잔류 크론을 <b>원래 슬롯으로</b> 되돌린다 (A22 ㋦ · 계약 §5 「gate 개방 · 놓친 잡 재생」).
 *
 * <h2>「지금」으로 돌리면 안 된다</h2>
 * 판정 잡은 전부 {@code Instant now} 를 받는다 — 그게 순위 집계 구간이자, 「정확히 N일째」의 기준이자,
 * <b>결정적 사건 키의 시간축</b>이다. 지금 시각으로 돌리면 오늘 날짜의 키가 나와서, 원래 슬롯의
 * 사건과 <b>다른 키</b>가 된다. 그러면 둘 중 하나가 일어난다: 이미 이관된 사건과 중복되거나(두 번
 * 발송), 원래 슬롯의 미발송이 영영 재생되지 않거나.
 *
 * <p>그래서 놓친 시각을 인자로 받아 그대로 넘긴다. 재생이 만드는 키는 그 크론이 제때 돌았다면
 * 만들었을 키와 <b>같다</b>.
 *
 * <h2>유효기간이 지난 종류는 건너뛴다</h2>
 * 「마감 2시간 전!」을 마감 다음 날에 보내는 것은 복구가 아니라 고장이다. 판정은
 * {@link NotificationCronReplayJob#validity()} 가 하고, 건너뛴 것은 <b>성공으로 기록하지 않는다</b> —
 * {@link Outcome#SKIPPED_EXPIRED} 로 남아 「보낸 적 없음」이 그대로 보인다.
 *
 * <h2>신 모드에서만 돈다</h2>
 * {@code LEGACY} 모드에서 이걸 돌리면 과거 슬롯의 알림을 <b>지금 FCM 으로 곧장</b> 쏜다. 재생은
 * 이관 절차의 일부이고, 그 절차는 신 경로가 켜진 뒤의 일이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationCronReplayService {

    private final NotificationDispatcher notificationDispatcher;
    private final ResultBundleCompletionService resultBundles;
    private final NotificationBatchRetry batchRetry;
    private final LeagueNotificationService leagueNotificationService;
    private final LeagueReengagementNotificationService leagueReengagementNotificationService;
    private final InactiveReturnNotificationService inactiveReturnNotificationService;
    private final BetEventNotificationService betEventNotificationService;
    private final SessionOpenNotificationService sessionOpenNotificationService;
    private final ChallengeWindowEndNotificationService challengeWindowEndNotificationService;
    private final ChallengeDurationEndNotificationService challengeDurationEndNotificationService;
    private final Clock clock;

    /** 재생 한 건의 결말. */
    public enum Outcome {

        /** 실제로 후보를 다시 찾아 원래 슬롯의 사건을 적었다. */
        REPLAYED,

        /** 유효기간이 지나 건너뛰었다 — <b>보낸 적 없음</b>이 그대로 남는다. */
        SKIPPED_EXPIRED,

        /** 구 모드라 돌리지 않았다. */
        SKIPPED_LEGACY_MODE,

        /** 재생 대상이 아닌 크론이다({@link NotificationCronReplayJob#NOT_REPLAYABLE}). */
        NOT_REPLAYABLE
    }

    /**
     * 재생 한 건의 결과.
     *
     * @param job       재생 대상
     * @param missedAt  놓친 슬롯 시각 — 판정과 사건 키가 이 시각으로 만들어진다
     * @param outcome   결말
     * @param detail    사람이 읽을 한 줄
     */
    public record ReplayResult(String job, Instant missedAt, Outcome outcome, String detail) {
    }

    /**
     * 놓친 크론 한 건을 원래 슬롯으로 재생한다.
     *
     * @param jobName  ShedLock 이름 또는 {@link NotificationCronReplayJob} 이름
     * @param missedAt <b>놓친 슬롯의 시각</b>. 지금 시각이 아니다 — 이 값이 판정 구간이자 사건 키의
     *                 시간축이다
     * @return 결과
     * @throws IllegalArgumentException 모르는 잡 이름일 때 — 조용히 넘기면 「재생했다」는 보고가
     *     아무 일도 하지 않은 실행을 덮는다
     */
    public ReplayResult replay(String jobName, Instant missedAt) {
        if (missedAt == null) {
            throw new IllegalArgumentException("놓친 슬롯 시각은 필수입니다 — 지금 시각으로 대신하지 않습니다.");
        }
        if (NotificationCronReplayJob.NOT_REPLAYABLE.stream().anyMatch(name -> name.equalsIgnoreCase(jobName))) {
            return new ReplayResult(jobName, missedAt, Outcome.NOT_REPLAYABLE,
                    "재생 대상이 아닙니다 — NotificationCronReplayJob.NOT_REPLAYABLE 주석의 사유를 보세요.");
        }
        NotificationCronReplayJob job = NotificationCronReplayJob.find(jobName);
        if (job == null) {
            throw new IllegalArgumentException("모르는 크론 이름입니다: " + jobName);
        }
        if (!notificationDispatcher.isOutboxMode()) {
            return new ReplayResult(job.lockName(), missedAt, Outcome.SKIPPED_LEGACY_MODE,
                    "구 모드에서는 재생하지 않습니다 — 과거 슬롯의 알림이 지금 FCM 으로 곧장 나갑니다.");
        }
        Instant now = clock.instant();
        Instant expiresAt = missedAt.plus(job.validity());
        if (!now.isBefore(expiresAt)) {
            log.info("놓친 크론 재생 생략 — job={}, missedAt={}, 유효기간 {} 경과",
                    job.lockName(), missedAt, job.validity());
            return new ReplayResult(job.lockName(), missedAt, Outcome.SKIPPED_EXPIRED,
                    "유효기간(" + job.validity() + ")이 지나 건너뜁니다 — 지금 보내면 거짓 알림입니다.");
        }

        invoke(job, missedAt);
        log.info("놓친 크론 재생 — job={}, missedAt={}", job.lockName(), missedAt);
        return new ReplayResult(job.lockName(), missedAt, Outcome.REPLAYED,
                "원래 슬롯(" + missedAt + ") 기준으로 후보를 다시 찾아 사건을 적었습니다.");
    }

    /**
     * 판정 잡을 <b>놓친 시각으로</b> 호출한다.
     *
     * <p>각 서비스의 {@code Instant} 주입 오버로드가 곧 재생 진입점이다 — 테스트용으로 만들어 둔
     * 이 구멍이 여기서 운영 기능이 된다. 새 오버로드를 만들지 않는 이유는 그것이 곧 두 번째 판정
     * 경로가 되어 «재생에서만 나는 버그»를 만들기 때문이다.
     *
     * @param job      재생 대상
     * @param missedAt 놓친 슬롯 시각
     */
    private void invoke(NotificationCronReplayJob job, Instant missedAt) {
        // 모든 재생이 같은 재시도 규칙을 탄다 — 잠금 충돌(40001·40P01)은 새 트랜잭션에서 원래 슬롯으로 다시 돈다.
        String name = job.lockName();
        switch (job) {
            case LEAGUE_WEEKLY_RESULTS ->
                    batchRetry.run(name, missedAt, leagueNotificationService::sendWeeklyResultNotifications);
            case LEAGUE_DEADLINE -> batchRetry.run(name, missedAt, leagueNotificationService::sendDeadlineReminders);
            case LEAGUE_SUNDAY_CRISIS ->
                    batchRetry.run(name, missedAt, leagueNotificationService::sendSundayCrisisReminders);
            case LEAGUE_RELEGATION_WARNING ->
                    batchRetry.run(name, missedAt, leagueNotificationService::sendRelegationWarnings);
            case LEAGUE_FINAL_DEADLINE ->
                    batchRetry.run(name, missedAt, leagueNotificationService::sendFinalDeadlineReminders);
            case INACTIVE_RETURN ->
                    batchRetry.run(name, missedAt, inactiveReturnNotificationService::sendInactiveReturnNotifications);
            case MISSED_FOCUS_TODAY ->
                    batchRetry.run(name, missedAt, leagueReengagementNotificationService::sendMissedFocusToday);
            case STREAK_AT_RISK ->
                    batchRetry.run(name, missedAt, leagueReengagementNotificationService::sendStreakAtRisk);
            case BET_EVENT_RESCAN -> batchRetry.run(name, missedAt, slot -> {
                betEventNotificationService.rescanAndFlush(slot);
                resultBundles.flushClosedBundles();
            });
            case SESSION_OPEN ->
                    batchRetry.run(name, missedAt, sessionOpenNotificationService::sendSessionOpenNotifications);
            case CHALLENGE_WINDOW_END ->
                    batchRetry.run(name, missedAt, challengeWindowEndNotificationService::sendWindowEndNotifications);
            case CHALLENGE_DURATION_END -> batchRetry.run(name, missedAt,
                    challengeDurationEndNotificationService::sendDurationEndNotifications);
        }
    }
}

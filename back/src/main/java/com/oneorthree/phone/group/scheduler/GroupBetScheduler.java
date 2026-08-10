package com.oneorthree.phone.group.scheduler;

import com.oneorthree.phone.common.config.SchedulingConfig;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.SettleTrigger;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.service.GroupBetSessionOpeningService;
import com.oneorthree.phone.group.service.GroupBetSessionOpeningService.SessionOpening;
import com.oneorthree.phone.group.service.GroupBetSettler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * 내기 회차 스케줄 진입점(GROMO-1269·1411·1412 재편) — 종전 "카테고리별 일 2회(01:00/12:00)"
 * 배치를 <b>{@code settle_after} 기반 5분 스캔</b>으로 바꾼다. 회차가 자기 정산 가능 시각을
 * 들고 있으므로(창형 = 창 끝+30분, 하루형 = 자정+카테고리 그레이스 — GROMO-1263 박제) 시각별
 * 크론 분기가 필요 없다. 창형 회차가 종료 당일 30분 뒤에 정산되는 것(N12)이 이 재편의 목적이다.
 *
 * <p><b>{@code GroupBetSettler} 와 다른 빈이다</b> — 같은 빈에 두면 {@code settle()} 호출이 자기
 * 호출(self-invocation)이라 {@code @Transactional} 프록시를 타지 않는다. 이 클래스 자체는
 * <b>의도적으로 무트랜잭션</b>이다(건별 격리 — 한 회차의 실패가 다른 회차를 말아먹지 않게).
 *
 * <p>멀티 인스턴스 중복 실행은 ShedLock 이 막는다(GROMO-1283, policy §E4) — 락을 놓쳐도 회차 행
 * 락 + CAS + 원장 멱등키가 이중 지급을 막으므로(정합은 별도 방어) 락은 중복 스캔 낭비 차단용이다.
 *
 * <p><b>이 클래스의 크론은 전용 스케줄러({@link SchedulingConfig#SETTLEMENT_SCHEDULER})에서 돈다</b>
 * — 공용 풀을 쓰면 같은 5분·15분 경계에 함께 뜨는 알림 팬아웃(대상마다 blocking FCM 호출)이 슬롯을
 * 선점해 정산과 인원 미달 환불이 그 뒤에 줄을 선다. 돈 처리가 알림에 밀리면 24h 자동 환불(N21)
 * 시한과 참가비 동결 시간이 그만큼 잠식된다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GroupBetScheduler {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupBetSettler groupBetSettler;
    private final GroupBetSessionOpeningService groupBetSessionOpeningService;

    /**
     * 5분 주기 정산 스캔(N12) — {@code settle_after} 가 지난 OPEN 회차 중 백오프
     * ({@code next_attempt_at})가 경과한 것만 집는다. 24h 초과분은 백오프와 무관하게 집힌다
     * ({@code findDue} 의 OR 술어) — 정산·환불 분기는 {@code settle} 이 락 안에서 스스로 가른다
     * (24h 판정이 진입점마다 흩어지면 수동 경로가 우회한다 — N21).
     */
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul",
            scheduler = SchedulingConfig.SETTLEMENT_SCHEDULER)
    @SchedulerLock(name = "group-bet-settle-scan")
    public void retryDueSessions() {
        Instant now = Instant.now();
        List<GroupChallengeBetSession> due = groupChallengeBetSessionRepository.findDue(
                now, now.minus(GroupBetSettler.REFUND_DEADLINE));
        for (GroupChallengeBetSession session : due) {
            try {
                // 실패는 건별 격리(E3) — settle 은 자체 트랜잭션이라 이 건만 롤백된다.
                groupBetSettler.settle(session.getId(), SettleTrigger.CRON);
            } catch (RuntimeException e) {
                // 시도 횟수 +1 과 다음 시도 시각을 같은 UPDATE 로 기록 — findDue 엔티티는 detached 라
                // 필드 변경으로는 영영 저장되지 않는다(백오프가 전진하지 못해 5분마다 무한 재시도).
                Instant next = nextAttemptAt(session, session.getSettleAttempts() + 1);
                groupChallengeBetSessionRepository.recordFailure(session.getId(), next, Instant.now());
                log.error("회차 정산 실패 — 백오프 기록. sessionId={}, attempts={}, nextAttemptAt={}",
                        session.getId(), session.getSettleAttempts() + 1, next, e);
            }
        }
    }

    /**
     * 백오프 단계 — 5m · 15m · 1h · 4h, 이후 4h 고정. 단 <b>24h 환불 데드라인을 넘기지 않는다</b>
     * ({@code settle_after + 21h} 실패의 다음 시도가 {@code +25h} 로 잡히면 {@code +24h} 시점
     * 스캔에 그 회차가 없어 참가비가 하드 SLO 를 넘겨 동결된다 — {@code findDue} 의 OR 술어와
     * 두 겹 방어). N21 은 시각에 걸린 약속이라 어떤 재시도 정책도 이를 늦출 수 없다.
     */
    static Instant nextAttemptAt(GroupChallengeBetSession session, int attempts) {
        Duration delay = switch (attempts) {
            case 1 -> Duration.ofMinutes(5);
            case 2 -> Duration.ofMinutes(15);
            case 3 -> Duration.ofHours(1);
            default -> Duration.ofHours(4);
        };
        Instant next = Instant.now().plus(delay);
        Instant deadline = session.getSettleAfter().plus(GroupBetSettler.REFUND_DEADLINE);
        return next.isAfter(deadline) ? deadline : next;
    }

    /**
     * 참가 마감 인원 미달 무산 크론(GROMO-1412, N47·FR-36) — 5분 주기로 {@code join_closes_at} 이
     * 지난 미달 회차를 집어 즉시 처리한다(0명 → UNUSED, 1명 → VOIDED + 환불). 정산 그레이스를
     * 기다리면 창형은 창 전체 + 30분 동안 혼자 남은 참가비가 묶이고 카드도 OPEN 으로 남는다(K1).
     * {@code settle()} 안의 인원 가드는 경합·크론 지연 대비 안전망으로 존치한다.
     */
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul",
            scheduler = SchedulingConfig.SETTLEMENT_SCHEDULER)
    @SchedulerLock(name = "group-bet-void-short-sessions")
    public void voidShortSessions() {
        List<UUID> targets = groupChallengeBetSessionRepository
                .findOpenPastJoinDeadlineWithFewParticipants(Instant.now());
        for (UUID sessionId : targets) {
            try {
                groupBetSettler.closeShortOrUnused(sessionId);
            } catch (RuntimeException e) {
                log.warn("무산 처리 실패 — 다음 틱 재시도. sessionId={}", sessionId, e);
            }
        }
    }

    /**
     * 회차 자동 개설(N35) — 00:05 정규 개설과 캐치업 보증 스캔을 <b>같은 멱등 스캔</b>으로 처리하며
     * <b>정산 스캔과 같은 5분 주기</b>로 돈다.
     *
     * <p><b>왜 시간 주기가 아니라 5분인가</b>: 매시 실행이면 00:05 틱이 죽거나 특정 챌린지 개설이
     * 실패했을 때 다음 기회가 01:05 다. 그 사이에 참가가 마감되는 창형(00:05~01:05 시작) 회차는
     * {@code openSession} 의 참가 마감 게이트에 걸려 <b>그날 영구히 생기지 않는다</b> — 배치 장애
     * 한 번에 그 챌린지 전원의 참가 경로가 사라진다. 5분 주기면 최대 공백이 5분이라 마감 전에
     * 회복된다. 대상이 없거나 이미 서 있으면 조회만 하고 끝나므로 빈 틱 비용은 무시할 수준이다.
     *
     * <p>크론 래퍼가 void 인 이유: ShedLock 은 락을 못 잡으면 메서드를 건너뛰고 null 을 돌려주는데,
     * 반환형이 primitive 면 그 null 이 언박싱 NPE 가 된다 — 잠금 대상 메서드는 void 가 규약이다.
     * 개설 건수를 쓰는 호출부(테스트·수동)는 {@link #openTodaySessions()} 를 직접 부른다.
     */
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul",
            scheduler = SchedulingConfig.SETTLEMENT_SCHEDULER)
    @SchedulerLock(name = "group-bet-ensure-today-sessions")
    public void ensureTodaySessions() {
        openTodaySessions();
    }

    /**
     * 개설 스캔 본체.
     *
     * <p>루프가 서비스가 아니라 여기 있는 이유: {@code openSession} 은 {@code @Transactional}
     * (챌린지 단위 격리)이라 같은 빈에서 돌리면 자기 호출로 프록시를 우회한다 — 크론 진입점은
     * 항상 별도 빈에서 프록시를 통해 서비스를 부른다(정산 스캔과 같은 규율).
     *
     * @return <b>실제로 INSERT 된</b> 회차 수(이미 있던 회차는 세지 않는다 — 멱등 스캔에서 기존
     *         회차를 신규로 세면 개설 장애 감시 지표가 항상 양수라 무의미해진다)
     */
    public int openTodaySessions() {
        LocalDate today = LocalDate.ofInstant(Instant.now(), KST);
        List<UUID> challengeIds = groupChallengeBetRepository.findActiveEnabledChallengeIds();
        int opened = 0;
        for (UUID challengeId : challengeIds) {
            try {
                if (groupBetSessionOpeningService.openSession(challengeId, today)
                        .filter(SessionOpening::created)
                        .isPresent()) {
                    opened++;
                }
            } catch (RuntimeException e) {
                // 건별 격리 — 한 챌린지의 개설 실패(CTI 유실 등)가 나머지 개설을 막지 않는다.
                log.error("회차 자동 개설 실패 — challengeId={}, date={}", challengeId, today, e);
            }
        }
        if (opened > 0) {
            log.info("회차 자동 개설 — 대상 {}건 중 {}건 신규 개설. date={}",
                    challengeIds.size(), opened, today);
        }
        return opened;
    }
}

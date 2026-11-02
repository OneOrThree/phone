package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.config.SchedulingConfig;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.data.domain.Limit;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 방치된 집중 세션 종결 틱 (GROMO-2636) — {@code ACTIVE} 인 채 마지막 전이 뒤 섬 12시간·바다 3시간이 지난 세션을
 * {@link FocusSessionLifecycleService#autoCloseStale} 로 <b>정산 없이</b> {@code ABANDONED} 로 닫는다.
 *
 * <p>왜 필요한가: 2.0 세션은 서버가 닫은 적이 없다(옛 12시간 스윕은 상세 행이 있는 세션을 대상에서 제외했고, #1247 이
 * 그 스윕 자체를 지웠다). 앱이 돌아오지 않는 세션은 하루 상한까지 매일 물고기를 적립하고 황금 물고기 추첨 인원에 계속
 * 세어졌다. 종결하면 lifecycle 이 {@code ACTIVE} 를 벗어나 {@code FocusRewardScheduler}·{@code GoldenFishScheduler} 가
 * 함께 멈춘다.
 *
 * <p>{@code FocusRestAutoCloseScheduler} 와 같은 패턴이다: 이 클래스는 무트랜잭션이고 세션마다 수명주기 서비스가 자기
 * 트랜잭션으로 돈다. 틱을 놓치거나 한 건이 실패해도 다음 차례에 같은 후보를 다시 집는다 — 판정 기준이 «틱이 돌았는가»가
 * 아니라 «마지막 전이 시각»이라 지연은 늦음일 뿐 누락이 아니다. <b>스위치를 두지 않는다</b> — 종결은 상세 행 배타 잠금 아래
 * 다시 판정하고, ShedLock 이 인스턴스 하나로 좁힌다.
 *
 * <p>{@code FocusRestAutoCloseScheduler} 와 달리 후보를 세션 id 순으로 돌아가며 본다. 닫지 못하는 세션이 한 배치를 채워도
 * 그 뒤 세션이 차례를 받아야 종결이 조용히 멈추지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FocusStaleSessionScheduler {

    /** 한 틱이 닫는 최대 건수 — 쌓인 방치 세션이 1스레드 풀을 오래 잡지 않게 자른다. 남은 건 다음 틱이 이어받는다. */
    static final int BATCH_SIZE = 50;

    /** 후보를 처음부터 볼 때의 시작점 — 어떤 세션 id 보다 작다. */
    static final UUID FROM_START = new UUID(0L, 0L);

    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionLifecycleService lifecycle;
    private final Clock clock;

    /** 다음 틱이 이어 볼 위치. 재시작으로 잃어도 처음부터 다시 볼 뿐이다. */
    private UUID resumeAfter = FROM_START;

    /**
     * 매분 40초 — 같은 1스레드 풀의 적립(0초)·황금 추첨(20초)·휴식 자동 종료(30초) 틱과 초를 어긋나게 둔다. 풀이
     * 하나라 정각에 겹치면 한쪽이 다른 쪽을 기다린다.
     *
     * <p>ponytail: 방치 후보 전수 스캔이라 대개 0건이다. 섬 규모가 커지면 {@code (lifecycle, last_transition_at)} 인덱스가
     * 다음 단계다.
     */
    @Scheduled(cron = "40 * * * * *", zone = "UTC", scheduler = SchedulingConfig.FOCUS_REWARD_SCHEDULER)
    @SchedulerLock(name = "focus-stale-session-close")
    public void closeStaleSessions() {
        Instant now = clock.instant();
        int closed = 0;
        List<UUID> sessionIds = focusSessionDetailRepository.findStaleActiveSessionIds(
                now.minus(FocusSessionLifecycleService.ISLAND_STALE_AFTER),
                now.minus(FocusSessionLifecycleService.SEA_STALE_AFTER), resumeAfter, Limit.of(BATCH_SIZE));
        resumeAfter = sessionIds.size() < BATCH_SIZE ? FROM_START : sessionIds.get(sessionIds.size() - 1);
        for (UUID sessionId : sessionIds) {
            try {
                if (lifecycle.autoCloseStale(sessionId)) {
                    closed++;
                }
            } catch (RuntimeException e) {
                // 건별 격리 — 다음 차례에 같은 세션을 다시 집는다(판정 기준이 마지막 전이 시각이라 멱등).
                log.error("방치 집중 세션 종료 실패 — 다음 차례에 재시도. session={}", sessionId, e);
            }
        }
        if (closed > 0) {
            log.info("방치된 집중 세션 자동 종료: {}건", closed);
        }
    }
}

package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.config.SchedulingConfig;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusRewardAccrualGate;
import com.oneorthree.phone.internal.service.FocusRewardAccrualService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 집중 보상 적립 틱 (GROMO-1990) — 매분 진행 중(ACTIVE) 세션을 훑어
 * {@link FocusRewardAccrualService#accrue}를 돌린다. 「60초마다 1마리」의 <b>그 60초</b>가 여기다.
 *
 * <p>{@code IslandQuestScheduler}·{@code IslandConstructionScheduler} 와 같은 패턴이다: 이 클래스는
 * 무트랜잭션이고 세션마다 적립 서비스가 자기 트랜잭션으로 돈다. 틱을 놓쳐도 다음 틱이 워터마크로
 * 밀린 몫을 한 번에 메운다 — 적립량은 «틱이 몇 번 돌았는가»가 아니라 «순수 집중 초»로만 정해진다.
 *
 * <p>돈 처리라 전용 풀({@link SchedulingConfig#SETTLEMENT_SCHEDULER})에서 돈다 — 알림 팬아웃에 밀리면
 * 사용자가 낚은 물고기가 늦게 들어온다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FocusRewardScheduler {

    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusRewardAccrualService accruals;
    /** 혼합 버전 배포의 이중 지급을 막는 단계 활성화 스위치 — 기본 꺼짐(그 클래스 javadoc). */
    private final FocusRewardAccrualGate gate;

    /**
     * 매분 정각 — 진행 중 세션 전수 스캔.
     *
     * <p><b>게이트가 닫혀 있으면 스캔조차 하지 않는다</b>({@link FocusRewardAccrualGate}) — 배포가 한 버전으로
     * 수렴하기 전에는 지급 주체가 둘이 되어 같은 시간이 두 번 나간다. 꺼져 있는 동안의 적립은 {@code finish}
     * 가 그 자리에서 한 번에 확정하므로 사용자가 손해를 보지는 않는다.
     *
     * <p>ponytail: 동시 집중 세션 수만큼 도는 순진한 스캔이다. 매분 수천 건을 넘기면
     * {@code rewarded_seconds} 와 마지막 전이 시각으로 「아직 1마리가 안 찬」 세션을 SQL 에서 미리
     * 걸러 내거나, 섬 단위로 샤딩하는 것이 다음 단계다.
     */
    @Scheduled(cron = "0 * * * * *", zone = "UTC", scheduler = SchedulingConfig.FOCUS_REWARD_SCHEDULER)
    @SchedulerLock(name = "focus-reward-accrual")
    public void accrueDueSessions() {
        if (!gate.isOpen()) {
            return;
        }
        for (UUID sessionId : focusSessionDetailRepository
                .findSessionIdsByLifecycle(FocusSessionLifecycle.ACTIVE)) {
            try {
                accruals.accrue(sessionId);
            } catch (RuntimeException e) {
                // 건별 격리 — 다음 틱이 같은 세션을 다시 집는다(적립은 워터마크 기반이라 멱등).
                log.error("집중 보상 적립 실패 — 다음 틱에 재시도. session={}", sessionId, e);
            }
        }
    }
}

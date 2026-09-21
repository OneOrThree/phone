package com.oneorthree.phone.quest.scheduler;

import com.oneorthree.phone.config.SchedulingConfig;
import com.oneorthree.phone.quest.repository.IslandQuestOccurrenceRepository;
import com.oneorthree.phone.quest.repository.IslandQuestRepository;
import com.oneorthree.phone.quest.service.IslandQuestService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * 섬 퀘스트 회차 개설과 전원 달성 보너스 정산 (GROMO-1773·1991) — 둘 다 매분 틱이다.
 *
 * <p>{@link com.oneorthree.phone.construction.scheduler.IslandConstructionScheduler} 와 같은 패턴 — 이 클래스는
 * 무트랜잭션이고 건마다 {@link IslandQuestService} 가 자기 트랜잭션으로 돈다. ShedLock 을 놓쳐도
 * 개설은 섬 행 잠금 + 존재 재확인 + (퀘스트, 날짜) 유일키가, 보너스는 회차 행 잠금 +
 * {@code bonus_settled_at} + 지갑 원장 유일키가 1회로 묶는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IslandQuestScheduler {

    /**
     * 보너스 finalizer 가 훑는 날짜 창 — 가장 긴 정산 마감(screen: 회차 날짜 + 2일 00:00Z + 한 틱,
     * {@link com.oneorthree.phone.quest.repository.domain.IslandQuestOccurrence#bonusSettleDeadline()})을 덮는다.
     */
    private static final int BONUS_SCAN_DAYS = 2;

    private final IslandQuestRepository quests;
    private final IslandQuestOccurrenceRepository occurrences;
    private final IslandQuestService service;
    private final Clock clock;

    /**
     * 오늘(UTC) 회차가 없는 퀘스트를 연다 — UTC 자정 직후 첫 틱이 새 회차를 열고 그 순간의 활성 주민으로
     * cohort 를 고정한다(결정 Q-3·Q-4). 놓친 틱은 다음 틱이 메운다.
     */
    @Scheduled(cron = "0 * * * * *", zone = "UTC", scheduler = SchedulingConfig.SETTLEMENT_SCHEDULER)
    @SchedulerLock(name = "island-quest-occurrence-open")
    public void openDueOccurrences() {
        LocalDate today = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC);
        for (UUID questId : quests.findIdsWithoutOccurrenceOn(today)) {
            try {
                service.openTodayIfMissing(questId);
            } catch (RuntimeException e) {
                // 건별 격리 — 다음 틱이 같은 퀘스트를 다시 집는다(개설은 멱등).
                log.error("퀘스트 회차 개설 실패 — 다음 틱에 재시도. questId={}", questId, e);
            }
        }
    }

    /**
     * 전원 달성 보너스 정산 (GROMO-1991) — 「전원 달성 시 대상 주민 수 × 5마리를 <b>즉시</b> 지급한다」
     * (기획 정본 「일일 퀘스트와 보상」 · 결정 Q-1-개정)의 그 <b>즉시</b>가 여기다. 수령(claim)과 독립이라
     * 아무도 «받기»를 누르지 않아도 보너스는 적립된다.
     *
     * <p><b>왜 틱인가</b>는 {@link IslandQuestService#settleBonusIfAllAchieved} javadoc 에 있다 — 요약하면
     * 달성은 저장되지 않는 파생값이고, 그 입력 하나(열린 집중 구간)는 writer 없이 시계만으로 바뀐다.
     *
     * <p>개설 틱과 30초 어긋나게 둔 것은 정각에 몰리는 정산 작업(집중 보상 적립도 정각이다)과 겹치지 않게
     * 하기 위해서다 — 새로 연 회차는 어차피 아무도 달성하지 않았으므로 순서에 의미가 없다.
     *
     * <p>ponytail: 보너스 없는 회차(대부분)를 마감까지 매분 다시 판정하는 순진한 스캔이다 — 상한은
     * 「퀘스트 수 × {@value #BONUS_SCAN_DAYS}일」이고 회차마다 판정 질의 네 건이 돈다(고르는 질의 자체는
     * 부분 인덱스가 받아 누적 회차 수와 무관하다 — {@link IslandQuestOccurrenceRepository#findIdsPendingBonusSince}).
     * 무거워지면 창이 시작된 focus 회차로 좁히거나, 판정 결과를 회차 행에 캐싱하는 것이 다음 단계다.
     */
    @Scheduled(cron = "30 * * * * *", zone = "UTC", scheduler = SchedulingConfig.SETTLEMENT_SCHEDULER)
    @SchedulerLock(name = "island-quest-bonus-settle")
    public void settleDueBonuses() {
        LocalDate from = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC).minusDays(BONUS_SCAN_DAYS);
        for (UUID occurrenceId : occurrences.findIdsPendingBonusSince(from)) {
            try {
                service.settleBonusIfAllAchieved(occurrenceId);
            } catch (RuntimeException e) {
                // 건별 격리 — 다음 틱이 같은 회차를 다시 집는다(적립은 bonus_settled_at 로 멱등).
                log.error("퀘스트 전원 달성 보너스 정산 실패 — 다음 틱에 재시도. occurrenceId={}", occurrenceId, e);
            }
        }
    }
}

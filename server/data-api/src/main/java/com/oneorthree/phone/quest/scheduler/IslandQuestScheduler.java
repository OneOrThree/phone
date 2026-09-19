package com.oneorthree.phone.quest.scheduler;

import com.oneorthree.phone.config.SchedulingConfig;
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
 * 섬 퀘스트 회차 개설 (GROMO-1773) — 매분 오늘(UTC) 회차가 없는 퀘스트를 찾아 연다. UTC 자정 직후 첫 틱이
 * 새 회차를 열고 그 순간의 활성 주민으로 cohort 를 고정한다(결정 Q-3·Q-4). 놓친 틱은 다음 틱이 메운다.
 *
 * <p>{@link com.oneorthree.phone.construction.scheduler.IslandConstructionScheduler} 와 같은 패턴 — 이 클래스는
 * 무트랜잭션이고 퀘스트마다 {@link IslandQuestService#openTodayIfMissing} 가 자기 트랜잭션으로 돈다.
 * ShedLock 을 놓쳐도 섬 행 잠금 + 존재 재확인 + (퀘스트, 날짜) 유일키가 이중 개설을 막는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IslandQuestScheduler {

    private final IslandQuestRepository quests;
    private final IslandQuestService service;
    private final Clock clock;

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
}

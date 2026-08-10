package com.oneorthree.phone.league.scheduler;

import com.oneorthree.phone.league.service.LeagueBatchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// 스케줄 트리거와 배치 로직 분리 — 테스트에서는 LeagueBatchService 를 단독 호출
@Slf4j
@Component
@RequiredArgsConstructor
public class LeagueScheduler {

    private final LeagueBatchService leagueBatchService;

    // 매주 월요일 00:00(KST) 주간 리그 마감/재편성 배치
    // 분산 락(GROMO-1283) — 티어 승강·리그 재편성은 멱등이 아니라 두 인스턴스가 겹쳐 돌면
    // 승강이 두 번 적용될 수 있다. 전 유저 순회라 길어질 수 있어 상한은 1시간으로 잡는다.
    @Scheduled(cron = "0 0 0 * * MON", zone = "Asia/Seoul")
    @SchedulerLock(name = "league-weekly-batch", lockAtMostFor = "PT1H")
    public void runWeeklyLeagueBatch() {
        log.info("리그 주간 배치 스케줄 트리거");
        leagueBatchService.runWeeklyBatch();
    }
}

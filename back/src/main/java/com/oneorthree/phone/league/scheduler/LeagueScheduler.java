package com.oneorthree.phone.league.scheduler;

import com.oneorthree.phone.league.service.LeagueBatchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// 스케줄 트리거와 배치 로직 분리 — 테스트에서는 LeagueBatchService 를 단독 호출
@Slf4j
@Component
@RequiredArgsConstructor
public class LeagueScheduler {

    private final LeagueBatchService leagueBatchService;

    // 매주 월요일 00:00(KST) 주간 리그 마감/재편성 배치
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (티켓 565)
    @Scheduled(cron = "0 0 0 * * MON", zone = "Asia/Seoul")
    public void runWeeklyLeagueBatch() {
        log.info("리그 주간 배치 스케줄 트리거");
        leagueBatchService.runWeeklyBatch();
    }
}

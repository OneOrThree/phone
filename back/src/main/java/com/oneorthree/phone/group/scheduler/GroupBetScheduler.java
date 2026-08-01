package com.oneorthree.phone.group.scheduler;

import com.oneorthree.phone.group.service.GroupBetSettlementService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// 스케줄 트리거와 배치 로직 분리 — 테스트에서는 GroupBetSettlementService 를 단독 호출
@Slf4j
@Component
@RequiredArgsConstructor
public class GroupBetScheduler {

    private final GroupBetSettlementService groupBetSettlementService;

    // 매일 04:00(KST) 전일자 내기 정산 배치.
    // 자정이 아니라 04:00 인 이유: 자정을 넘겨 끝난 집중 세션이 종료일 버킷에 들어올 여유(그레이스 4h).
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (리그 배치와 같은 한계 — 티켓 565)
    @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Seoul")
    public void runDailyBetSettlement() {
        log.info("그룹 챌린지 내기 일 정산 스케줄 트리거");
        groupBetSettlementService.settleDueBets();
    }
}

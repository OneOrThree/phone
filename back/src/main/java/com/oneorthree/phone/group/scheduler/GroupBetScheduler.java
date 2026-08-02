package com.oneorthree.phone.group.scheduler;

import com.oneorthree.phone.group.domain.MissionCategory;
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

    // 매일 01:00(KST) 전일자 FOCUS 내기 정산 배치.
    // 집중 일별 통계는 세션 "종료 시각"에 귀속되므로 자정이면 어제 데이터가 완결된다 — 자정을 넘겨 끝난
    // 세션까지 들어올 그레이스 1h 만 두고 앞당겼다(종전 04:00·4h).
    // TODO: 멀티 인스턴스 배포 시 분산 락 필요 (리그 배치와 같은 한계 — 티켓 565)
    @Scheduled(cron = "0 0 1 * * *", zone = "Asia/Seoul")
    public void runFocusBetSettlement() {
        log.info("그룹 챌린지 FOCUS 내기 일 정산 스케줄 트리거");
        groupBetSettlementService.settleDueBets(MissionCategory.FOCUS);
    }

    // 매일 12:00(KST) 전일자 SCREEN_TIME 내기 정산 배치(2차).
    // 스크린타임은 네이티브가 기기에 보존만 하고 서버 업로드는 앱 실행 때 일어난다 — 어제치 최종 보고가
    // 유저의 "다음날 첫 앱 실행"에 올라오므로, 01:00 에 정산하면 미보고=미달성 억울 패배가 양산된다.
    // 오전 내내 보고 기회를 준 뒤 12:00 시점 저장값으로 확정한다(isFinal 불문 — 확정 정책).
    @Scheduled(cron = "0 0 12 * * *", zone = "Asia/Seoul")
    public void runScreenTimeBetSettlement() {
        log.info("그룹 챌린지 SCREEN_TIME 내기 일 정산 스케줄 트리거");
        groupBetSettlementService.settleDueBets(MissionCategory.SCREEN_TIME);
    }
}

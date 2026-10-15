package com.oneorthree.phone.ranking.scheduler;

import com.oneorthree.phone.ranking.service.IslandRankingFreezeService;
import com.oneorthree.phone.ranking.support.RankingWeek;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 주간 섬 랭킹의 <b>분모 동결</b> 스케줄 트리거 (GROMO-1997).
 *
 * <p>매주 일요일 00:00 <b>UTC</b> 에 「방금 끝난」 주의 섬별 주민 수를 적는다. 존이 UTC 인 것은 주 경계 자체가
 * UTC 이기 때문이다({@link RankingWeek}) — 1.x 리그의 KST 월요일 크론과 <b>다른 축</b>이고, 같은 값으로 맞추면
 * 안 된다.
 *
 * <p>배치 로직은 {@link IslandRankingFreezeService} 에 있다 — 테스트는 크론 없이 그것만 부른다
 * ({@code LeagueScheduler} 와 같은 구성). 트랜잭션 경계도 거기다: {@code @Scheduled} 는 스스로 트랜잭션이 없고,
 * 리포지토리는 경계를 소유하지 않는다(규약 §4·§5).
 *
 * <p>분산 락은 리그 배치와 같은 이유로 건다 — 인스턴스가 둘이면 같은 주를 동시에 적는다. 다만 이 배치는
 * {@code ON CONFLICT DO NOTHING} 이라 <b>이미 적힌 값을 덮지 않으므로</b> 락은 중복 작업을 줄일 뿐 정합성의
 * 유일한 방어선이 아니다.
 *
 * <p><b>배치가 아예 돌지 못한 주는 분모가 없고, 그 주의 랭킹은 비어 있다.</b> 그때 「지금 인원」으로 대체하지
 * 않는 것이 이 배치의 존재 이유다 — 대체 경로가 있으면 주민을 내보내 분모를 줄이는 조작이 그대로 살아난다.
 * 조용히 틀린 순위보다 비어 있는 순위가 낫다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IslandRankingFreezeScheduler {

    private final IslandRankingFreezeService freeze;

    @Scheduled(cron = "0 0 0 * * SUN", zone = "UTC")
    @SchedulerLock(name = "island-weekly-ranking-freeze", lockAtMostFor = "PT30M")
    public void freezePreviousWeek() {
        log.info("주간 섬 랭킹 분모 동결 스케줄 트리거");
        freeze.freezePreviousWeek();
    }
}

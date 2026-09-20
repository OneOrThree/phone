package com.oneorthree.phone.ranking.service;

import com.oneorthree.phone.ranking.repository.IslandWeeklyMemberCountRepository;
import com.oneorthree.phone.ranking.support.RankingWeek;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;

/**
 * 주간 섬 랭킹의 <b>분모 동결</b> 배치 로직 (GROMO-1997).
 *
 * <p>스케줄 트리거({@code IslandRankingFreezeScheduler})와 분리돼 있다 — 테스트는 크론 없이 이것만 부른다
 * ({@code LeagueScheduler}/{@code LeagueBatchService} 와 같은 구성).
 *
 * <p><b>트랜잭션 경계가 여기 있는 이유.</b> 리포지토리는 경계를 소유하지 않는다(규약 §4·§5,
 * {@code RepositoryTransactionalConventionTest} 가 정적으로 강제한다) — {@code @Modifying} 벌크 쿼리는
 * 호출부의 경계에 편승한다. 그런데 이 배치의 진입점은 {@code @Scheduled} 라 스스로는 트랜잭션이 없으므로,
 * 그 경계를 열어 주는 자리가 필요하다. 그 자리가 이 서비스다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IslandRankingFreezeService {

    private final IslandWeeklyMemberCountRepository denominators;
    private final Clock clock;

    /**
     * 「방금 끝난 주」의 분모를 동결한다 — 크론이 부르는 진입점이다.
     *
     * @return 새로 적힌 섬 수. 재실행이면 0 이다
     */
    @Transactional
    public int freezePreviousWeek() {
        // 크론이 도는 시각(일요일 00:00Z)은 이미 «새» 주에 속한다 — 대상은 직전 주다.
        return freeze(RankingWeek.previousWeekStart(clock.instant()));
    }

    /**
     * 그 주의 분모를 동결한다.
     *
     * <p>멱등이다 — {@code ON CONFLICT DO NOTHING} 이라 두 번 돌든, 늦게 돌든, 분산 락이 새든 그 주의 분모는
     * <b>처음 적힌 값</b> 그대로다. 덮어쓰기였다면 하루 늦게 돈 배치가 하루치 이탈을 반영해 동결의 의미가
     * 사라진다.
     *
     * @param week 동결할 주의 시작일(UTC 일요일)
     * @return 새로 적힌 섬 수
     */
    @Transactional
    public int freeze(LocalDate week) {
        int frozen = denominators.freeze(week);
        log.info("주간 섬 랭킹 분모 동결 week={} 섬={}", week, frozen);
        return frozen;
    }
}

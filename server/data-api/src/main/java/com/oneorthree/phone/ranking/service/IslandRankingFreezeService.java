package com.oneorthree.phone.ranking.service;

import com.oneorthree.phone.ranking.repository.IslandWeeklyMemberCountRepository;
import com.oneorthree.phone.ranking.support.RankingWeek;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
<<<<<<< HEAD
import org.springframework.beans.factory.annotation.Value;
=======
>>>>>>> origin/bfeat/GROMO-1997-island-weekly-ranking
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
<<<<<<< HEAD
import java.time.Duration;
import java.time.Instant;
=======
>>>>>>> origin/bfeat/GROMO-1997-island-weekly-ranking
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
<<<<<<< HEAD
     * 주 종료 경계로부터 이만큼 안에 실행됐을 때만 동결한다.
     *
     * <p>분모는 「주가 끝난 시점의 인원」이어야 하는데, 이탈 시각이 DB 에 없어 사후 판정이 불가능하다
     * ({@code IslandWeeklyMemberCountRepository#freeze} 참고). 그래서 <b>실행이 경계에 얼마나 가까운지</b>가
     * 정확도의 상한이다 — 크론이 제때 돌면 창은 초 단위이고, 장애로 한참 늦게 돌면 그만큼 어긋난다.
     *
     * <p>유예를 넘기면 <b>쓰지 않는다</b>. {@code ON CONFLICT DO NOTHING} 이 첫 값을 영구 고착시키므로, 늦게
     * 돈 배치가 「하루치 이탈이 반영된 인원」을 그 주의 정답으로 굳히는 쪽이 더 나쁘다. 안 쓰면 그 주는 분모가
     * 없어 랭킹에서 빠지고(RK-D01-결손) 경고 로그가 남는다 — 조용히 틀린 순위보다 비어 있는 순위가 낫다.
     */
    @Value("${ranking.freeze.grace:PT1H}")
    private Duration grace;

    /**
     * 「방금 끝난 주」의 분모를 동결한다 — 크론이 부르는 진입점이다.
     *
     * @return 새로 적힌 섬 수. 재실행이거나 유예를 넘겼으면 0 이다
=======
     * 「방금 끝난 주」의 분모를 동결한다 — 크론이 부르는 진입점이다.
     *
     * @return 새로 적힌 섬 수. 재실행이면 0 이다
>>>>>>> origin/bfeat/GROMO-1997-island-weekly-ranking
     */
    @Transactional
    public int freezePreviousWeek() {
        // 크론이 도는 시각(일요일 00:00Z)은 이미 «새» 주에 속한다 — 대상은 직전 주다.
        return freeze(RankingWeek.previousWeekStart(clock.instant()));
    }

    /**
     * 그 주의 분모를 동결한다.
     *
<<<<<<< HEAD
     * <p>기준 시각은 크론이 «실행된» 순간이 아니라 그 주의 <b>종료 경계</b>다 — 경계 이후 가입은 세지 않는다.
     * 이탈 방향은 DB 에 근거가 없어 쿼리로 닫을 수 없고, 대신 {@link #grace} 가 어긋날 수 있는 창을 시간으로
     * 좁힌다.
     *
     * <p>멱등이다 — {@code ON CONFLICT DO NOTHING} 이라 두 번 돌아도 그 주의 분모는 <b>처음 적힌 값</b> 그대로다.
     *
     * @param week 동결할 주의 시작일(UTC 일요일)
     * @return 새로 적힌 섬 수. 아직 끝나지 않은 주이거나 유예를 넘겼으면 0
     */
    @Transactional
    public int freeze(LocalDate week) {
        Instant boundary = RankingWeek.endInstant(week);
        Instant now = clock.instant();
        if (now.isBefore(boundary)) {
            // 아직 끝나지 않은 주는 동결할 것이 없다 — 진행 중인 주는 조회가 «지금» 인원으로 나눈다.
            log.warn("주간 섬 랭킹 분모 동결 건너뜀 — 아직 끝나지 않은 주 week={} boundary={}", week, boundary);
            return 0;
        }
        if (now.isAfter(boundary.plus(grace))) {
            log.warn("주간 섬 랭킹 분모 동결 건너뜀 — 유예({})를 넘겨 실행됨 week={} boundary={} now={}. "
                    + "이 주는 분모가 없어 랭킹에서 빠진다(틀린 인원을 영구 고착시키지 않는다)", grace, week, boundary, now);
            return 0;
        }
        int frozen = denominators.freeze(week, boundary);
        log.info("주간 섬 랭킹 분모 동결 week={} boundary={} 섬={}", week, boundary, frozen);
=======
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
>>>>>>> origin/bfeat/GROMO-1997-island-weekly-ranking
        return frozen;
    }
}

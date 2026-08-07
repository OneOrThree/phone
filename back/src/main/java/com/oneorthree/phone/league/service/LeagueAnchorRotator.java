package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.OptionalInt;

/**
 * 주차 anchor 회전(재실행 가드 → 이전 anchor 마감 → 신규 anchor 생성)을 유저 정산 루프와 분리된
 * 트랜잭션으로 <b>선커밋</b>한다 (GROMO-1218).
 *
 * <p>{@link LeagueBatchService} 와 클래스를 나눈 이유는 자기 호출(self-invocation)로는 프록시를
 * 타지 않아 별도 트랜잭션이 성립하지 않기 때문이다({@code GroupBetSettler} 선례). anchor 가 유저
 * 정산보다 먼저 커밋되므로, 이후 정산이 일부 실패해도 {@code existsByStartedAt} 가드는 그대로
 * 성립한다 — 같은 주차 재실행은 BATCH_ALREADY_RUN 으로 막힌다.
 */
@Service
@RequiredArgsConstructor
public class LeagueAnchorRotator {

    private final LeagueArenaRepository leagueArenaRepository;

    /**
     * @param now          배치 실행 시각 — 이전 anchor 의 endedAt 으로 기록된다
     * @param newWeekStart 이번 주차 시작(KST 월요일 00:00 Instant) — 신규 anchor 의 startedAt
     * @return 마감한 이전 ACTIVE anchor 수
     * @throws LeagueException 이번 주차 anchor 가 이미 있으면 BATCH_ALREADY_RUN
     */
    @Transactional
    public int rotate(Instant now, Instant newWeekStart) {
        if (leagueArenaRepository.existsByStartedAt(newWeekStart)) {
            throw new LeagueException(LeagueErrorCode.BATCH_ALREADY_RUN);
        }
        return doRotate(now, newWeekStart);
    }

    /**
     * 정산 재개(GROMO-1239) 전용 관용 진입점 — 이번 주차 anchor 가 이미 있으면 회전 없이 건너뛴다.
     * 기본 run 경로(스케줄러 포함)의 BATCH_ALREADY_RUN 시맨틱은 {@link #rotate} 가 그대로 유지한다.
     *
     * <p>동시 재개 둘이 exists 를 함께 통과하는 레이스는 uq_league_arenas_started_at(V15) 유니크
     * 제약이 늦은 쪽을 터뜨려 막는다 — 동시 최초 run 과 같은 노출이라 여기서 더 좁히지 않는다.
     *
     * @return 회전했으면 마감한 이전 ACTIVE anchor 수, anchor 가 이미 있어 건너뛰었으면 empty
     */
    @Transactional
    public OptionalInt rotateIfAbsent(Instant now, Instant newWeekStart) {
        if (leagueArenaRepository.existsByStartedAt(newWeekStart)) {
            return OptionalInt.empty();
        }
        return OptionalInt.of(doRotate(now, newWeekStart));
    }

    // 회전 본체 — 두 진입점의 가드 통과 후 공통 경로. private 자기 호출이라 호출자의 트랜잭션에 묶인다.
    private int doRotate(Instant now, Instant newWeekStart) {
        List<LeagueArena> previousActiveAnchors = leagueArenaRepository
                .findByStatusAndStartedAtBefore(LeagueArenaStatus.ACTIVE, newWeekStart);
        previousActiveAnchors.forEach(arena -> arena.end(now));
        leagueArenaRepository.save(LeagueArena.builder()
                .startedAt(newWeekStart)
                .status(LeagueArenaStatus.ACTIVE)
                .build());
        return previousActiveAnchors.size();
    }
}

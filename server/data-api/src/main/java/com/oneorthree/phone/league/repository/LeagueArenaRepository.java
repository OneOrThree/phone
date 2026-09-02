package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.repository.domain.LeagueArena;
import com.oneorthree.phone.league.repository.domain.LeagueArenaStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 주차별 아레나(경쟁 단위) 조회 창구. {@code startedAt} 이 곧 주차 키(KST 월요일 00:00)라, 여기 있는
 * 조회들은 모두 "어느 주차의 아레나인가"를 시각으로 지목한다.
 */
public interface LeagueArenaRepository extends JpaRepository<LeagueArena, UUID> {

    /**
     * 주간 배치의 중복 실행 가드. 이 주차의 아레나가 이미 만들어졌다는 것은 run 이 커밋됐다는 뜻이다.
     *
     * @param startedAt 확인할 주차 시작 시각(KST 월요일 00:00)
     * @return 그 주차 아레나가 하나라도 있으면 true — run 은 409, resume 은 이 값이 false 일 때 409
     */
    boolean existsByStartedAt(Instant startedAt);

    /**
     * @param status 걸러낼 아레나 상태
     * @return 그 상태의 아레나 전부. 주차를 가리지 않으므로 마감 누락분까지 함께 걸린다
     */
    List<LeagueArena> findByStatus(LeagueArenaStatus status);

    /**
     * 마감 대상 조회 — 경계를 <b>배타</b>로 본다. 다음 주차 시작 시각을 넘기면 그 주차 자신은 빠지고
     * 그보다 앞선 주차만 걸리므로, 진행 중인 주차를 실수로 마감하지 않는다.
     *
     * @param status    걸러낼 아레나 상태
     * @param startedAt 이 시각 <b>미만</b>에 시작한 아레나만 대상
     * @return 조건에 맞는 아레나 전부
     */
    List<LeagueArena> findByStatusAndStartedAtBefore(LeagueArenaStatus status, Instant startedAt);
}

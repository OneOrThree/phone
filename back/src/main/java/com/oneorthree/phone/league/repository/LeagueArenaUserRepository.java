package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueMemberResult;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeagueArenaUserRepository extends JpaRepository<LeagueArenaUser, UUID> {

    List<LeagueArenaUser> findByLeagueArenaOrderByTotalFocusMinutesDesc(LeagueArena leagueArena);

    Optional<LeagueArenaUser> findByLeagueArenaAndUser(LeagueArena leagueArena, User user);

    // 내 현재 ACTIVE 아레나 멤버십 (유저당 활성 아레나는 최대 1개)
    @Query("SELECT m FROM LeagueArenaUser m JOIN FETCH m.leagueArena la "
            + "WHERE m.user.id = :userId AND la.status = :status")
    Optional<LeagueArenaUser> findByUserAndArenaStatus(
            @Param("userId") UUID userId, @Param("status") LeagueArenaStatus status);

    // GROMO-710: 여러 유저의 현재 아레나 멤버십을 한 번에 배치 조회 (친구 목록·요청·검색 티어 도출, N+1 방지).
    // user JOIN FETCH 로 유저 접근 N+1 방지, leagueArena 는 상태 필터에만 쓰여 fetch 불필요.
    @Query("SELECT m FROM LeagueArenaUser m JOIN FETCH m.user JOIN m.leagueArena la "
            + "WHERE m.user.id IN :userIds AND la.status = :status")
    List<LeagueArenaUser> findByUserIdInAndArenaStatus(
            @Param("userIds") Collection<UUID> userIds, @Param("status") LeagueArenaStatus status);

    // GROMO-646: 세션 완료 시 주간 누적 집중 시간 += 용 비관적 락 조회.
    // DailyFocusStat.findByUserAndDateForUpdate 와 동일 패턴 — 동시 세션 종료의 lost update 차단.
    // (fetch join 없음 — 갱신에 leagueArena 로드 불필요, 락과 fetch join 병행 회피)
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT m FROM LeagueArenaUser m WHERE m.user.id = :userId AND m.leagueArena.status = :status")
    Optional<LeagueArenaUser> findByUserAndArenaStatusForUpdate(
            @Param("userId") UUID userId, @Param("status") LeagueArenaStatus status);

    // 랭킹용 — user fetch 로 닉네임 N+1 방지, 동점은 id 오름차순으로 순위 결정
    @Query("SELECT m FROM LeagueArenaUser m JOIN FETCH m.user "
            + "WHERE m.leagueArena = :arena ORDER BY m.totalFocusMinutes DESC, m.id ASC")
    List<LeagueArenaUser> findRankedByArena(@Param("arena") LeagueArena arena);

    // 전역 카테고리 랭킹 — 이번 주 ACTIVE 아레나 전체 × occupation 필터, 상위 N 제한
    @Query("SELECT m FROM LeagueArenaUser m JOIN FETCH m.user u "
            + "WHERE m.leagueArena.status = 'ACTIVE' AND u.occupation = :occupation "
            + "ORDER BY m.totalFocusMinutes DESC, m.id ASC")
    List<LeagueArenaUser> findRankedByActiveArenasAndOccupation(
            @Param("occupation") Occupation occupation, Pageable pageable);

    // 전역 전체 랭킹 — 이번 주 ACTIVE 아레나 전체(직군 무관), 상위 N 제한 (GROMO-611)
    // occupation 필터만 뺀 findRankedByActiveArenasAndOccupation 형제 쿼리, 동점은 id 오름차순
    @Query("SELECT m FROM LeagueArenaUser m JOIN FETCH m.user "
            + "WHERE m.leagueArena.status = 'ACTIVE' "
            + "ORDER BY m.totalFocusMinutes DESC, m.id ASC")
    List<LeagueArenaUser> findRankedByActiveArenas(Pageable pageable);

    // 주간 알림용 — 직전 주차 ENDED 아레나의 확정 결과별 멤버 (GROMO-528).
    // user JOIN FETCH 로 N+1 방지, weekStartAt equality 는 412 배치의 atStartOfDay(KST) 산정과 동일 유래라 안전
    @Query("SELECT m FROM LeagueArenaUser m JOIN FETCH m.user JOIN FETCH m.leagueArena la "
            + "WHERE la.status = 'ENDED' AND la.startedAt = :weekStartAt AND m.result IN :results")
    List<LeagueArenaUser> findEndedByWeekStartAndResultIn(
            @Param("weekStartAt") Instant weekStartAt,
            @Param("results") Collection<LeagueMemberResult> results);
}

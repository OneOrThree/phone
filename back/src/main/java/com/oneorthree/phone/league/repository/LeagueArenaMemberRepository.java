package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaMember;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeagueArenaMemberRepository extends JpaRepository<LeagueArenaMember, UUID> {

    List<LeagueArenaMember> findByLeagueArenaOrderByTotalFocusMinutesDesc(LeagueArena leagueArena);

    Optional<LeagueArenaMember> findByLeagueArenaAndUser(LeagueArena leagueArena, User user);

    // 내 현재 ACTIVE 아레나 멤버십 (유저당 활성 아레나는 최대 1개)
    @Query("SELECT m FROM LeagueArenaMember m JOIN FETCH m.leagueArena la "
            + "WHERE m.user.id = :userId AND la.status = :status")
    Optional<LeagueArenaMember> findByUserAndArenaStatus(
            @Param("userId") UUID userId, @Param("status") LeagueArenaStatus status);

    // 랭킹용 — user fetch 로 닉네임 N+1 방지, 동점은 id 오름차순으로 순위 결정
    @Query("SELECT m FROM LeagueArenaMember m JOIN FETCH m.user "
            + "WHERE m.leagueArena = :arena ORDER BY m.totalFocusMinutes DESC, m.id ASC")
    List<LeagueArenaMember> findRankedByArena(@Param("arena") LeagueArena arena);
}

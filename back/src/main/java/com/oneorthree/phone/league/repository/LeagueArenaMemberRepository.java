package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaMember;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeagueArenaMemberRepository extends JpaRepository<LeagueArenaMember, UUID> {

    List<LeagueArenaMember> findByLeagueArenaOrderByTotalFocusMinutesDesc(LeagueArena leagueArena);

    Optional<LeagueArenaMember> findByLeagueArenaAndUser(LeagueArena leagueArena, User user);
}

package com.oneorthree.phone.repository.league;

import com.oneorthree.phone.domain.league.LeagueGroup;
import com.oneorthree.phone.domain.league.LeagueGroupMember;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeagueGroupMemberRepository extends JpaRepository<LeagueGroupMember, UUID> {

    List<LeagueGroupMember> findByLeagueGroupOrderByTotalFocusMinutesDesc(LeagueGroup leagueGroup);

    Optional<LeagueGroupMember> findByLeagueGroupAndUser(LeagueGroup leagueGroup, User user);
}

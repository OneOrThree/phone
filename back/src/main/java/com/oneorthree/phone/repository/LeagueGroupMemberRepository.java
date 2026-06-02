package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.LeagueGroup;
import com.oneorthree.phone.domain.LeagueGroupMember;
import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface LeagueGroupMemberRepository extends JpaRepository<LeagueGroupMember, Long> {
    List<LeagueGroupMember> findByLeagueGroupOrderByTotalFocusMinutesDesc(LeagueGroup leagueGroup);
    Optional<LeagueGroupMember> findByLeagueGroupAndUser(LeagueGroup leagueGroup, User user);
}

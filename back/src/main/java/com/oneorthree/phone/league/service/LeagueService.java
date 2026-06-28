package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaMember;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.repository.LeagueArenaMemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class LeagueService {

    private final LeagueArenaMemberRepository leagueArenaMemberRepository;

    public LeagueTierResponse getMyTier(UUID userId) {
        return findActiveMembership(userId)
                .map(member -> {
                    LeagueArena arena = member.getLeagueArena();
                    return new LeagueTierResponse(
                            true,
                            member.getTierLevel(),
                            arena.getId(),
                            arena.getWeekStartAt(),
                            arena.getStatus().name());
                })
                .orElseGet(() -> new LeagueTierResponse(false, null, null, null, null));
    }

    public List<LeagueMemberResponse> getMyRanking(UUID userId) {
        return findActiveMembership(userId)
                .map(member -> {
                    List<LeagueArenaMember> ranked =
                            leagueArenaMemberRepository.findRankedByArena(member.getLeagueArena());
                    List<LeagueMemberResponse> responses = new ArrayList<>();
                    for (int i = 0; i < ranked.size(); i++) {
                        LeagueArenaMember m = ranked.get(i);
                        responses.add(new LeagueMemberResponse(
                                i + 1,
                                m.getUser().getId(),
                                m.getUser().getNickname(),
                                m.getTotalFocusMinutes(),
                                resultName(m)));
                    }
                    return responses;
                })
                .orElseGet(List::of);
    }

    public LeagueRankResponse getMyRank(UUID userId) {
        return findActiveMembership(userId)
                .map(member -> {
                    List<LeagueArenaMember> ranked =
                            leagueArenaMemberRepository.findRankedByArena(member.getLeagueArena());
                    Integer myRank = null;
                    for (int i = 0; i < ranked.size(); i++) {
                        if (ranked.get(i).getUser().getId().equals(userId)) {
                            myRank = i + 1;
                            break;
                        }
                    }
                    if (myRank == null) {
                        throw new IllegalStateException("Active member not in ranked list: userId=" + userId);
                    }
                    return new LeagueRankResponse(
                            true,
                            myRank,
                            member.getTotalFocusMinutes(),
                            resultName(member));
                })
                .orElseGet(() -> new LeagueRankResponse(false, null, null, null));
    }

    private Optional<LeagueArenaMember> findActiveMembership(UUID userId) {
        return leagueArenaMemberRepository.findByUserAndArenaStatus(userId, LeagueArenaStatus.ACTIVE);
    }

    private String resultName(LeagueArenaMember member) {
        return member.getResult() != null ? member.getResult().name() : null;
    }
}

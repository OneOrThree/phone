package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.user.domain.Occupation;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
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

    private final LeagueArenaUserRepository leagueArenaUserRepository;
    private final LeagueTierConfigRepository leagueTierConfigRepository;

    public LeagueTierResponse getMyTier(UUID userId) {
        return findActiveMembership(userId)
                .map(member -> {
                    LeagueArena arena = member.getLeagueArena();
                    return new LeagueTierResponse(
                            true,
                            member.getTierLevel(),
                            arena.getId(),
                            arena.getWeekStartAt(),
                            arena.getStatus().name(),
                            badgeId(member.getTierLevel()));
                })
                .orElseGet(() -> new LeagueTierResponse(false, null, null, null, null, null));
    }

    /**
     * 랭킹 조회.
     * category 지정 시: 전역 ACTIVE 아레나 전체에서 같은 occupation 유저 상위 100명.
     * category 미지정 시: 내 ACTIVE 아레나 멤버 랭킹(기존 동작).
     */
    public List<LeagueMemberResponse> getMyRanking(UUID userId, Occupation category) {
        if (category != null) {
            List<LeagueArenaUser> ranked = leagueArenaUserRepository
                    .findRankedByActiveArenasAndOccupation(category, PageRequest.of(0, 100));
            return toResponses(ranked);
        }
        return findActiveMembership(userId)
                .map(member -> toResponses(
                        leagueArenaUserRepository.findRankedByArena(member.getLeagueArena())))
                .orElseGet(List::of);
    }

    private List<LeagueMemberResponse> toResponses(List<LeagueArenaUser> ranked) {
        List<LeagueMemberResponse> responses = new ArrayList<>();
        for (int i = 0; i < ranked.size(); i++) {
            LeagueArenaUser m = ranked.get(i);
            responses.add(new LeagueMemberResponse(
                    i + 1,
                    m.getUser().getId(),
                    m.getUser().getNickname(),
                    m.getTotalFocusMinutes(),
                    resultName(m)));
        }
        return responses;
    }

    public LeagueRankResponse getMyRank(UUID userId) {
        return findActiveMembership(userId)
                .map(member -> {
                    List<LeagueArenaUser> ranked =
                            leagueArenaUserRepository.findRankedByArena(member.getLeagueArena());
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

    private Optional<LeagueArenaUser> findActiveMembership(UUID userId) {
        return leagueArenaUserRepository.findByUserAndArenaStatus(userId, LeagueArenaStatus.ACTIVE);
    }

    private String resultName(LeagueArenaUser member) {
        return member.getResult() != null ? member.getResult().name() : null;
    }

    // 티어 레벨 → 배지 식별자 (시드 보장 1~5; 누락 시 null 로 방어)
    private String badgeId(Integer tierLevel) {
        return leagueTierConfigRepository.findById(tierLevel)
                .map(LeagueTierConfig::getBadgeId)
                .orElse(null);
    }
}

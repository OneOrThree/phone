package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.user.domain.Occupation;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class LeagueService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String SCOPE_TOTAL = "total";
    // 전역 랭킹 상한 — 아레나를 가로지르는 대량 조회를 막기 위한 안전 상한
    private static final int MAX_RANKING_LIMIT = 500;

    private final LeagueArenaUserRepository leagueArenaUserRepository;
    private final LeagueTierConfigRepository leagueTierConfigRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final PinnedUserRepository pinnedUserRepository;

    public LeagueTierResponse getMyTier(UUID userId) {
        return findActiveMembership(userId)
                .map(member -> {
                    LeagueArena arena = member.getLeagueArena();
                    return new LeagueTierResponse(
                            true,
                            member.getTierLevel(),
                            arena.getId(),
                            arena.getStartedAt(),
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
        // 핀 조회(조회자 me가 핀한 유저 집합)는 실제 반환할 멤버가 있을 때만 수행 —
        // 빈-멤버십 조기반환(List.of()) 경로에서 불필요한 쿼리를 태우지 않는다.
        // 랭킹 각 멤버 isPinned 후조인(user 핀 통일, GROMO-609).
        if (category != null) {
            List<LeagueArenaUser> ranked = leagueArenaUserRepository
                    .findRankedByActiveArenasAndOccupation(category, PageRequest.of(0, 100));
            return toResponses(ranked, pinnedUserRepository.findPinnedUserIdsByUserId(userId));
        }
        return findActiveMembership(userId)
                .map(member -> toResponses(
                        leagueArenaUserRepository.findRankedByArena(member.getLeagueArena()),
                        pinnedUserRepository.findPinnedUserIdsByUserId(userId)))
                .orElseGet(List::of);
    }

    /**
     * 전역 전체 유저 랭킹 조회 (직군 무관, GROMO-611).
     * 이번 주 ACTIVE 아레나 전체를 가로질러 totalFocusMinutes 내림차순 상위 limit 명을 반환한다.
     * rank 는 아레나가 아닌 전역 순번(반환 리스트 인덱스+1)이다.
     *
     * @param scope 랭킹 범위. 현재는 "total"(대소문자 무관)만 지원, 그 외 값은 INVALID_SCOPE(400).
     * @param limit 상위 인원 상한. 대량 조회를 막기 위해 1~{@value #MAX_RANKING_LIMIT} 범위로 클램프한다.
     */
    public List<LeagueMemberResponse> getGlobalRanking(String scope, int limit) {
        if (scope != null && !SCOPE_TOTAL.equalsIgnoreCase(scope)) {
            throw new LeagueException(LeagueErrorCode.INVALID_SCOPE);
        }
        int clamped = Math.max(1, Math.min(limit, MAX_RANKING_LIMIT));
        List<LeagueArenaUser> ranked = leagueArenaUserRepository
                .findRankedByActiveArenas(PageRequest.of(0, clamped));
        // 전역 랭킹은 per-caller 핀 없음, 후속 개선 여지 — isPinned=false (빈 핀 집합)
        return toResponses(ranked, Set.of());
    }

    private List<LeagueMemberResponse> toResponses(List<LeagueArenaUser> ranked, Set<UUID> pinnedIds) {
        List<LeagueMemberResponse> responses = new ArrayList<>();
        for (int i = 0; i < ranked.size(); i++) {
            LeagueArenaUser m = ranked.get(i);
            UUID memberId = m.getUser().getId();
            responses.add(new LeagueMemberResponse(
                    i + 1,
                    memberId,
                    m.getUser().getNickname(),
                    // 멤버별 실제 티어 — 이미 조회된 league_arena_users 행의 컬럼(추가 쿼리 없음, GROMO-748)
                    m.getTierLevel(),
                    m.getTotalFocusMinutes(),
                    resultName(m),
                    pinnedIds.contains(memberId)));
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
                    // ACTIVE 멤버십이 있을 때만 발행 — 미소속 조회는 이벤트 생략
                    userActivityEventLogger.log(UserActivityEvent.LEAGUE_RANK_VIEWED,
                            Map.of("my_rank", myRank,
                                    "league_id", member.getLeagueArena().getId().toString(),
                                    "tier_level", member.getTierLevel(),
                                    "total_focus_minutes", member.getTotalFocusMinutes()));
                    return new LeagueRankResponse(
                            true,
                            myRank,
                            member.getTotalFocusMinutes(),
                            resultName(member));
                })
                .orElseGet(() -> new LeagueRankResponse(false, null, null, null));
    }

    /**
     * 다음 리그 마감 스케줄을 반환한다.
     * 다음 리셋 시각(다음 월요일 00:00 KST)과 남은 시간(초)을 계산한다.
     * 인증만 통과하면 항상 성공(미배정 유저도 계산 가능).
     */
    public LeagueScheduleResponse getMySchedule(UUID userId) {
        return getMySchedule(userId, Instant.now());
    }

    /**
     * 테스트에서 고정 시각을 주입하기 위한 package-private 오버로드.
     *
     * @param userId 인증된 유저 ID (향후 유저별 타임존 반영 여지)
     * @param now    현재 시각
     */
    LeagueScheduleResponse getMySchedule(UUID userId, Instant now) {
        ZonedDateTime nowKst = now.atZone(KST);
        // 정확히 월요일 00:00:00이면 next(MONDAY) = 다음 주 월요일(remainingSeconds=604800)
        ZonedDateTime nextMondayKst = nowKst
                .with(TemporalAdjusters.next(DayOfWeek.MONDAY))
                .toLocalDate()
                .atStartOfDay(KST);
        Instant nextResetAt = nextMondayKst.toInstant();
        long remainingSeconds = Duration.between(now, nextResetAt).getSeconds();
        return new LeagueScheduleResponse(nextResetAt, remainingSeconds);
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

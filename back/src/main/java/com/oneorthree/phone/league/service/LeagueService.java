package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.service.FocusLiveInfoLookup;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.league.domain.LeagueRankingPosition;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueLastResultResponse;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class LeagueService {

    private static final String SCOPE_TOTAL = "total";
    private static final int MY_RANKING_LIMIT = 100;
    // 전역 랭킹 상한 — 대량 조회를 막기 위한 안전 상한
    private static final int MAX_RANKING_LIMIT = 500;

    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueTierConfigRepository leagueTierConfigRepository;
    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final UserRepository userRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final PinnedUserRepository pinnedUserRepository;
    private final FocusLiveInfoLookup focusLiveInfoLookup;
    private final LeagueWeek leagueWeek;

    public LeagueTierResponse getMyTier(UUID userId) {
        return getMyTier(userId, Instant.now());
    }

    LeagueTierResponse getMyTier(UUID userId, Instant now) {
        return userRepository.findById(userId)
                .filter(user -> !user.isDeleted())
                // 게스트는 온보딩 전 리그 미참가 — assigned=false(중립)로 반환해 클라이언트가 미배정으로 처리한다.
                .filter(user -> !user.isGuest())
                .map(user -> new LeagueTierResponse(
                        true,
                        user.getTierLevel(),
                        null,
                        leagueWeek.currentWeekStart(now),
                        null,
                        badgeId(user.getTierLevel())))
                .orElseGet(() -> new LeagueTierResponse(false, null, null, null, null, null));
    }

    /**
     * category가 없으면 활성 유저 전체, 있으면 해당 직군의 주간 집중 시간 상위 100명을 반환한다.
     * 각 멤버의 집중 라이브 정보(당일 집중분·진행중 여부·시작시각·태그명)를 date 기준으로 1회 배치 조회해 채운다(GROMO-824).
     */
    public List<LeagueMemberResponse> getMyRanking(UUID userId, Occupation category, LocalDate date) {
        Instant now = Instant.now();
        List<LeagueRankingRow> ranked = leagueRankingQueryRepository.findTop(
                leagueWeek.currentWeekStartDate(now), leagueWeek.currentDate(now), category, MY_RANKING_LIMIT);
        if (ranked.isEmpty()) {
            return List.of();
        }
        // GROMO-824: ranked userId 들의 집중 라이브 정보를 1회 배치 조회(FocusLiveInfoLookup 공용, N+1 방지).
        // date 는 클라 로컬 타임존 기준 오늘. 미조회 유저는 맵에 없어 toResponses 가 기본값(0/false/null) 처리.
        List<UUID> userIds = ranked.stream().map(LeagueRankingRow::userId).toList();
        Map<UUID, FocusLiveInfo> liveInfo = focusLiveInfoLookup.liveInfoByUserId(userIds, date);
        return toResponses(ranked, pinnedUserRepository.findPinnedUserIdsByUserId(userId), liveInfo);
    }

    /**
     * 전역 전체 유저 랭킹 조회. 활성 유저를 모수로 이번 주 DailyFocusStat 합계 상위 limit 명을 반환한다.
     *
     * @param scope 랭킹 범위. 현재는 "total"(대소문자 무관)만 지원, 그 외 값은 INVALID_SCOPE(400).
     * @param limit 상위 인원 상한. 대량 조회를 막기 위해 1~{@value #MAX_RANKING_LIMIT} 범위로 클램프한다.
     */
    public List<LeagueMemberResponse> getGlobalRanking(String scope, int limit) {
        if (scope != null && !SCOPE_TOTAL.equalsIgnoreCase(scope)) {
            throw new LeagueException(LeagueErrorCode.INVALID_SCOPE);
        }
        int clamped = Math.max(1, Math.min(limit, MAX_RANKING_LIMIT));
        Instant now = Instant.now();
        List<LeagueRankingRow> ranked = leagueRankingQueryRepository.findTop(
                leagueWeek.currentWeekStartDate(now), leagueWeek.currentDate(now), null, clamped);
        // 전역 랭킹은 per-caller 핀 없음, 후속 개선 여지 — isPinned=false (빈 핀 집합).
        // 라이브 필드는 /me/ranking 스코프 — 전역은 빈 맵으로 기본값(false/0/null) 전달(GROMO-824, 전역 라이브는 별도 티켓).
        return toResponses(ranked, Set.of(), Map.of());
    }

    private List<LeagueMemberResponse> toResponses(List<LeagueRankingRow> ranked, Set<UUID> pinnedIds,
                                                   Map<UUID, FocusLiveInfo> liveInfo) {
        List<LeagueMemberResponse> responses = new ArrayList<>();
        for (int i = 0; i < ranked.size(); i++) {
            LeagueRankingRow row = ranked.get(i);
            FocusLiveInfo info = liveInfo.get(row.userId());
            responses.add(new LeagueMemberResponse(
                    i + 1,
                    row.userId(),
                    row.nickname(),
                    row.tierLevel(),
                    row.totalFocusSeconds(),
                    pinnedIds.contains(row.userId()),
                    info != null && info.isFocusing(),
                    info != null ? info.focusTimeMinutes() : 0,
                    info != null ? info.focusStartedAt() : null,
                    info != null ? info.focusTagName() : null));
        }
        return responses;
    }

    public LeagueRankResponse getMyRank(UUID userId) {
        return getMyRank(userId, Instant.now());
    }

    /** 테스트에서 고정 시각을 주입하기 위한 package-private 오버로드. */
    LeagueRankResponse getMyRank(UUID userId, Instant now) {
        LocalDate fromDate = leagueWeek.currentWeekStartDate(now);
        LocalDate toDate = leagueWeek.currentDate(now);
        // 순위(assigned/myRank)는 이번 주 진행 상황, result는 직전 주 정산 결과 — 서로 독립이라 각각 조회한다.
        String settlementResult = latestSettlementResult(userId, now);
        return leagueRankingQueryRepository.findRankOf(userId, fromDate, toDate)
                .map(position -> toRankResponse(position, settlementResult))
                .orElseGet(() -> new LeagueRankResponse(false, null, null, settlementResult));
    }

    /**
     * 직전(방금 마감된) 주차 정산 결과만 노출한다. 정산 확정 후 그 주 동안 승격·유지·강등을 반환하고,
     * 미정산(진행 중)이거나 그보다 오래된 결과는 null 로 둔다 → 문서의 "진행 중엔 result=null".
     */
    private String latestSettlementResult(UUID userId, Instant now) {
        Instant previousWeekStart = leagueWeek.previousWeekStart(now);
        return leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(userId)
                .filter(result -> result.getWeekStartAt().equals(previousWeekStart))
                .map(result -> result.getResult().name())
                .orElse(null);
    }

    private LeagueRankResponse toRankResponse(LeagueRankingPosition position, String settlementResult) {
        userActivityEventLogger.log(UserActivityEvent.LEAGUE_RANK_VIEWED,
                Map.of("my_rank", position.rank(),
                        "tier_level", position.tierLevel(),
                        "total_focus_seconds", position.totalFocusSeconds()));
        return new LeagueRankResponse(true, position.rank(), position.totalFocusSeconds(), settlementResult);
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
        Instant nextResetAt = leagueWeek.currentWeekStart(now).plus(Duration.ofDays(7));
        long remainingSeconds = Duration.between(now, nextResetAt).getSeconds();
        return new LeagueScheduleResponse(nextResetAt, remainingSeconds);
    }

    // ── 주간 마감 결과 조회 + 확인(ack) (GROMO-567) — additive, 기존 메서드 미접촉 ──

    /**
     * 주간 배치(GROMO-817)가 남긴 최신 정산 결과 1건을 조회한다.
     * 결과 행이 있으면 전체 필드를 매핑하고(acknowledged = acknowledgedAt != null),
     * 없으면(미배정/신규 유저) {@code hasResult=false} 응답을 반환한다. 주차 필터 없이 최신 1건만 본다.
     */
    public LeagueLastResultResponse getLastResult(UUID userId) {
        return leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(userId)
                .map(result -> new LeagueLastResultResponse(
                        true,
                        result.getWeekStartAt(),
                        result.getResult().name(),
                        result.getPreviousTierLevel(),
                        result.getNewTierLevel(),
                        result.getFocusSeconds(),
                        result.getAcknowledgedAt() != null))
                .orElseGet(() -> new LeagueLastResultResponse(false, null, null, null, null, null, false));
    }

    /**
     * 클라가 조회(GET)로 받은 그 주차 결과를 확인 처리한다. ack 시점에 '최신행'을 다시 찾지 않고
     * {@code weekStartAt} 으로 대상을 고정해, 그 사이 배치가 새 주차 결과를 넣어도 유저가 못 본 결과를 삼키지 않는다.
     * 조건부 원자적 UPDATE 라 대상 없음·이미 확인됨·동시 중복 호출 모두 안전하게 no-op 이며 멱등하다.
     */
    @Transactional
    public void acknowledgeLastResult(UUID userId, Instant weekStartAt) {
        acknowledgeLastResult(userId, weekStartAt, Instant.now());
    }

    /** 테스트에서 고정 시각을 주입하기 위한 package-private 오버로드. 트랜잭션은 public 진입점이 연다. */
    void acknowledgeLastResult(UUID userId, Instant weekStartAt, Instant now) {
        leagueWeeklyResultRepository.acknowledge(userId, weekStartAt, now);
    }

    // 티어 레벨 → 배지 식별자 (시드 보장 1~5; 누락 시 null 로 방어)
    private String badgeId(Integer tierLevel) {
        return leagueTierConfigRepository.findById(tierLevel)
                .map(LeagueTierConfig::getBadgeId)
                .orElse(null);
    }
}

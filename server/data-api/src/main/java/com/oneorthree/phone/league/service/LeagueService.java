package com.oneorthree.phone.league.service;

import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.currency.support.CurrencyRewardPolicy;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
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
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.league.support.LeagueWeek;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 리그 화면이 읽는 조회 서비스 — 내 티어·랭킹·내 순위·마감 스케줄·주간 정산 결과.
 *
 * <p>주차 경계는 전부 {@link LeagueWeek}(KST 월요일 00:00)에서 나오고, 점수 원천은 DailyFocusStat 하나다.
 * 티어의 정본은 주간 배치가 확정해 users.tier_level 에 써 둔 값이라, 이 서비스는 티어를 계산하지 않고 읽기만 한다.
 *
 * <p>리그 모수는 "활성 + 닉네임 있음"(온보딩 완주)이다 — 그 밖의 유저는 예외가 아니라 미배정 응답으로 나간다.
 * 랭킹의 라이브 필드는 순위 쿼리와 <b>같은 SQL 스냅샷</b>에서 나와야 하며, 그 이유는 각 메서드 주석에 있다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class LeagueService {

    private static final String SCOPE_TOTAL = "total";
    private static final int MY_RANKING_LIMIT = 100;
    /**
     * 전역 랭킹 상한 — 대량 조회를 막기 위한 안전 상한
     */
    private static final int MAX_RANKING_LIMIT = 500;

    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueTierConfigRepository leagueTierConfigRepository;
    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final CurrencyTransactionRepository currencyTransactionRepository;
    private final UserRepository userRepository;
    private final PinnedUserRepository pinnedUserRepository;
    private final FriendshipRepository friendshipRepository;
    private final LeagueWeek leagueWeek;

    /**
     * 내 현재 티어와 이번 KST 주차 시작 시각.
     *
     * @param userId 조회자
     * @return 배정 유저면 티어·배지·주차 시작. 탈퇴했거나 온보딩을 끝내지 않아(닉네임 없음) 리그 모수 밖이면
     *         예외가 아니라 assigned=false 인 중립 응답이다 — 신규 유저 화면이 에러로 깨지지 않게 하려는 것
     */
    public LeagueTierResponse getMyTier(UUID userId) {
        return getMyTier(userId, Instant.now());
    }

    LeagueTierResponse getMyTier(UUID userId, Instant now) {
        return userRepository.findById(userId)
                .filter(user -> !user.isDeleted())
                // 온보딩 미완주(닉네임 없음)는 리그 미참가 — assigned=false(중립)로 반환해 클라이언트가
                // 미배정으로 처리한다. 게스트라도 닉네임까지 등록했으면 참가한다 (GROMO-1508).
                // 빈 문자열까지 보는 이유는 랭킹 쿼리와 동일 — GROMO-1215 이전 "" 레거시 행 (코드리뷰 반영).
                .filter(user -> user.getNickname() != null && !user.getNickname().isBlank())
                .map(user -> new LeagueTierResponse(
                        true,
                        user.getTierLevel(),
                        leagueWeek.currentWeekStart(now),
                        badgeId(user.getTierLevel())))
                .orElseGet(() -> new LeagueTierResponse(false, null, null, null));
    }

    /**
     * category가 없으면 활성 유저 전체, 있으면 해당 직군의 주간 집중 시간 상위 100명을 반환한다.
     * 라이브 4필드(당일 집중분·진행중 여부·시작시각·태그명)는 전부 랭킹 쿼리의 같은 행에서 나온다
     * (GROMO-824 → 코드리뷰 반영으로 배치 조회 제거 — 별도 조회와 섞으면 그 사이 세션이
     * 시작·종료·전환된 유저의 순위·경과·태그·당일분이 서로 다른 시점을 가리킨다).
     *
     * @param date 서버 판정 축(KST) 기준 오늘 — API 계약(required 파라미터)은 유지하지만 당일분
     *             집계는 이제 랭킹 쿼리의 :toDate(서버 KST 오늘)를 쓰므로 값은 참조하지 않는다.
     * @param userId   조회자 — 핀·친구 배지 판정에만 쓰이고 랭킹 모수·순서에는 관여하지 않는다
     * @param category 지정하면 같은 직군만, null 이면 직군 무관 전체
     * @return 순위 오름차순 상위 100명. 모수가 비면 빈 리스트이고 후조인 쿼리도 돌지 않는다
     */
    public List<LeagueMemberResponse> getMyRanking(UUID userId, Occupation category, LocalDate date) {
        Instant now = Instant.now();
        List<LeagueRankingRow> ranked = leagueRankingQueryRepository.findTop(
                leagueWeek.currentWeekStartDate(now), leagueWeek.currentDate(now), category, MY_RANKING_LIMIT, now);
        if (ranked.isEmpty()) {
            return List.of();
        }
        return toResponses(ranked,
                pinnedUserRepository.findPinnedUserIdsByUserId(userId),
                friendshipRepository.findFriendUserIdsByUserId(userId));
    }

    /**
     * 전역 전체 유저 랭킹 조회. 활성 유저를 모수로 이번 주 DailyFocusStat 합계 상위 limit 명을 반환한다.
     *
     * @param userId 조회자 — isFriend 후조인용 (GROMO-1630). 랭킹 모수·순서에는 관여하지 않는다.
     * @param scope  랭킹 범위. 현재는 "total"(대소문자 무관)만 지원, 그 외 값은 INVALID_SCOPE(400).
     * @param limit  상위 인원 상한. 대량 조회를 막기 위해 1~{@value #MAX_RANKING_LIMIT} 범위로 클램프한다.
     * @return 순위 오름차순 상위 limit 명. 핀 배지는 전역 스코프 밖이라 전부 false 이고, 친구 배지는 채운다
     */
    public List<LeagueMemberResponse> getGlobalRanking(UUID userId, String scope, int limit) {
        if (scope != null && !SCOPE_TOTAL.equalsIgnoreCase(scope)) {
            throw new LeagueException(LeagueErrorCode.INVALID_SCOPE);
        }
        int clamped = Math.max(1, Math.min(limit, MAX_RANKING_LIMIT));
        Instant now = Instant.now();
        List<LeagueRankingRow> ranked = leagueRankingQueryRepository.findTop(
                leagueWeek.currentWeekStartDate(now), leagueWeek.currentDate(now), null, clamped, now);
        if (ranked.isEmpty()) {
            return List.of();
        }
        // 전역 랭킹은 per-caller 핀 없음, 후속 개선 여지 — isPinned=false (빈 핀 집합, 결정 장부 N03).
        // isFriend 는 채운다 — 앱이 전체 탭에도 친구 표시를 그리므로 비우면 회귀다 (GROMO-1630).
        // 라이브 필드는 여기서도 채운다: 정렬이 '확정 집계 + 진행 중 경과' 기준이 되면서(findTop)
        // 라이브를 안 실으면 클라가 확정값만 그려 "위 행이 아래 행보다 시간이 적은" 목록이 된다.
        return toResponses(ranked, Set.of(), friendshipRepository.findFriendUserIdsByUserId(userId));
    }

    /**
     * 랭킹 행을 응답으로 변환한다. <b>라이브 4필드가 전부 랭킹 쿼리의 같은 행(같은 SQL 스냅샷)에서
     * 나온다</b>(코드리뷰 반영) — 정렬 점수·isFocusing·focusStartedAt(정렬에 쓴 앵커)·태그명·당일
     * 집중분이 한 시점을 가리키므로, 조회 사이에 세션이 시작·종료·전환돼도 "순위는 라이브인데
     * 표시는 확정값" · "A 세션 경과 + B 세션 태그" · "완료분 포함 당일분 + 살아있는 앵커의 이중
     * 계상" 같은 조합이 생기지 않는다. 클라가 그리는 base + (now − focusStartedAt) 이 정렬
     * 점수와 정확히 같다.
     */
    private List<LeagueMemberResponse> toResponses(
            List<LeagueRankingRow> ranked, Set<UUID> pinnedIds, Set<UUID> friendIds) {
        List<LeagueMemberResponse> responses = new ArrayList<>();
        for (int i = 0; i < ranked.size(); i++) {
            LeagueRankingRow row = ranked.get(i);
            Instant liveStartedAt = row.liveStartedAt();
            responses.add(new LeagueMemberResponse(
                    i + 1,
                    row.userId(),
                    row.nickname(),
                    row.tierLevel(),
                    row.totalFocusSeconds(),
                    pinnedIds.contains(row.userId()),
                    friendIds.contains(row.userId()),
                    liveStartedAt != null,
                    row.todayFocusSeconds() / 60,
                    liveStartedAt,
                    liveStartedAt != null ? row.liveTagName() : null));
        }
        return responses;
    }

    /**
     * 진행 중인 이번 주차에서 내가 몇 등인지. 순위는 상위 100명 목록과 <b>같은 정렬 기준</b>(확정 집계 +
     * 진행 중 세션 경과)으로 세므로, 목록 밖에 있어도 화면과 어긋나지 않는다.
     *
     * @param userId 조회자
     * @return 순위와 누적 집중 초. 리그 모수 밖이면 assigned=false 이고 나머지 필드는 null 이다.
     *         이 API 는 화면 포커스마다 호출돼도 활동 로그를 남기지 않는다
     */
    public LeagueRankResponse getMyRank(UUID userId) {
        return getMyRank(userId, Instant.now());
    }

    /** 테스트에서 고정 시각을 주입하기 위한 package-private 오버로드. */
    LeagueRankResponse getMyRank(UUID userId, Instant now) {
        LocalDate fromDate = leagueWeek.currentWeekStartDate(now);
        LocalDate toDate = leagueWeek.currentDate(now);
        // 활동 로그(LEAGUE_RANK_VIEWED)는 남기지 않는다 — 클라가 리그 화면 포커스마다 호출해도
        // 계측이 부풀지 않아야 화면에서 이 API를 쓸 수 있다(구 계측은 사용처가 없어 함께 제거).
        return leagueRankingQueryRepository.findRankOf(userId, fromDate, toDate, now)
                .map(position -> new LeagueRankResponse(true, position.rank(), position.totalFocusSeconds()))
                .orElseGet(() -> new LeagueRankResponse(false, null, null));
    }

    /**
     * 다음 리그 마감 스케줄을 반환한다.
     * 다음 리셋 시각(다음 월요일 00:00 KST)과 남은 시간(초)을 계산한다.
     * 인증만 통과하면 항상 성공(미배정 유저도 계산 가능).
     *
     * @param userId 조회자 — 지금은 값을 쓰지 않는다(유저별 타임존을 넣을 자리로 남겨 뒀다)
     * @return 다음 KST 월요일 00:00 과 그때까지 남은 초. 유저 상태와 무관하게 같은 값이다
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
     *
     * @param userId 결과의 주인
     * @return 최신 정산 결과. 승급 보너스 금액은 배치가 실제로 원장에 지급한 흔적(멱등키)이 있을 때만
     *         채우고, 없으면 0 이다 — 지급 없이 금액만 보이는 오보고를 막는다
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
                        result.getAcknowledgedAt() != null,
                        // 승급 보너스 — 배치가 실제로 원장에 지급(멱등키 league:{주차}:{uid})한 경우에만 보고한다.
                        // 배포 전 승급 결과는 그 지급이 없어 오보고를 막는다(코드리뷰 반영). 산정은 배치와 동일 공식.
                        result.getResult() == LeagueWeeklyResultType.PROMOTED
                                && currencyTransactionRepository.existsByIdempotencyKey(
                                        "league:" + result.getWeekStartAt() + ":" + userId)
                                ? CurrencyRewardPolicy.leaguePromotionReward(result.getNewTierLevel())
                                : 0))
                .orElseGet(() -> new LeagueLastResultResponse(false, null, null, null, null, null, false, 0));
    }

    /**
     * 클라가 조회(GET)로 받은 그 주차 결과를 확인 처리한다. ack 시점에 '최신행'을 다시 찾지 않고
     * {@code weekStartAt} 으로 대상을 고정해, 그 사이 배치가 새 주차 결과를 넣어도 유저가 못 본 결과를 삼키지 않는다.
     * 조건부 원자적 UPDATE 라 대상 없음·이미 확인됨·동시 중복 호출 모두 안전하게 no-op 이며 멱등하다.
     *
     * @param userId      결과의 주인
     * @param weekStartAt 확인 처리할 주차 — 클라가 조회로 받은 값을 그대로 실어야 한다
     */
    @Transactional
    public void acknowledgeLastResult(UUID userId, Instant weekStartAt) {
        acknowledgeLastResult(userId, weekStartAt, Instant.now());
    }

    /** 테스트에서 고정 시각을 주입하기 위한 package-private 오버로드. 트랜잭션은 public 진입점이 연다. */
    void acknowledgeLastResult(UUID userId, Instant weekStartAt, Instant now) {
        leagueWeeklyResultRepository.acknowledge(userId, weekStartAt, now);
    }

    /**
     * 티어 레벨 → 배지 식별자 (시드 보장 1~5; 누락 시 null 로 방어)
     */
    private String badgeId(Integer tierLevel) {
        return leagueTierConfigRepository.findById(tierLevel)
                .map(LeagueTierConfig::getBadgeId)
                .orElse(null);
    }
}

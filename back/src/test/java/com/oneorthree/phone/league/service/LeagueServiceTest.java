package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.service.FocusLiveInfoLookup;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.league.domain.LeagueRankingPosition;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.dto.LeagueLastResultResponse;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class LeagueServiceTest {

    private static final int FOURTEEN_HOURS_IN_SECONDS = 14 * 60 * 60;

    @InjectMocks
    private LeagueService leagueService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private LeagueTierConfigRepository leagueTierConfigRepository;

    @Mock
    private LeagueRankingQueryRepository leagueRankingQueryRepository;

    @Mock
    private LeagueWeeklyResultRepository leagueWeeklyResultRepository;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private PinnedUserRepository pinnedUserRepository;

    @Mock
    private FocusLiveInfoLookup focusLiveInfoLookup;

    @Mock
    private CurrencyTransactionRepository currencyTransactionRepository;

    @Spy
    private LeagueWeek leagueWeek = new LeagueWeek();

    private LeagueTierConfig tierConfig(int tierLevel, String badgeId) {
        return LeagueTierConfig.builder()
                .tierLevel(tierLevel)
                .badgeId(badgeId)
                .promotionTime(tierLevel * FOURTEEN_HOURS_IN_SECONDS)
                .relegationTime((tierLevel - 1) * FOURTEEN_HOURS_IN_SECONDS)
                .build();
    }

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID U2 = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final Instant NOW = Instant.parse("2026-06-24T03:00:00Z");
    private static final Instant WEEK_START = Instant.parse("2026-06-21T15:00:00Z");
    // NOW 기준 직전 주(방금 마감된 주) 시작 = 2026-06-15 00:00 KST
    private static final Instant PREVIOUS_WEEK_START = Instant.parse("2026-06-14T15:00:00Z");
    // 라이브 집계 기준일(클라 로컬 오늘)
    private static final LocalDate DATE = LocalDate.of(2026, 6, 24);

    private LeagueRankingRow rankingRow(UUID userId, String nickname, int focusSeconds) {
        return new LeagueRankingRow(userId, nickname, 3, focusSeconds);
    }

    private FocusLiveInfo liveInfo(int minutes, boolean focusing, Instant startedAt, String tagName) {
        return new FocusLiveInfo(minutes, focusing, startedAt, tagName);
    }

    private LeagueWeeklyResult weeklyResult(Instant weekStartAt, LeagueWeeklyResultType result) {
        return LeagueWeeklyResult.builder()
                .weekStartAt(weekStartAt)
                .previousTierLevel(2)
                .newTierLevel(3)
                .result(result)
                .focusSeconds(200)
                .build();
    }

    // ── getMyTier ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("내 티어 조회 성공 → 활성 User 티어와 설정 배지를 호환 DTO에 매핑")
    void getMyTierAssigned() {
        given(userRepository.findById(USER_ID))
                .willReturn(Optional.of(User.builder().id(USER_ID).tierLevel(3).build()));
        given(leagueTierConfigRepository.findById(3))
                .willReturn(Optional.of(tierConfig(3, "hyperfocus")));

        LeagueTierResponse response = leagueService.getMyTier(USER_ID, NOW);

        assertThat(response.assigned()).isTrue();
        assertThat(response.tierLevel()).isEqualTo(3);
        assertThat(response.weekStartAt()).isEqualTo(WEEK_START);
        assertThat(response.badgeId()).isEqualTo("hyperfocus");
    }

    @Test
    @DisplayName("내 티어 조회 - 티어 설정 누락 → badgeId=null 로 방어")
    void getMyTierBadgeConfigMissing() {
        given(userRepository.findById(USER_ID))
                .willReturn(Optional.of(User.builder().id(USER_ID).tierLevel(3).build()));
        given(leagueTierConfigRepository.findById(3))
                .willReturn(Optional.empty());

        LeagueTierResponse response = leagueService.getMyTier(USER_ID, NOW);

        assertThat(response.assigned()).isTrue();
        assertThat(response.badgeId()).isNull();
    }

    @Test
    @DisplayName("내 티어 조회 - 존재하지 않는 유저 → assigned=false")
    void getMyTierUnassigned() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        LeagueTierResponse response = leagueService.getMyTier(USER_ID, NOW);

        assertThat(response.assigned()).isFalse();
        assertThat(response.tierLevel()).isNull();
        assertThat(response.badgeId()).isNull();
    }

    @Test
    @DisplayName("내 티어 조회 - 탈퇴 유저 → assigned=false")
    void getMyTierDeletedUserIsUnassigned() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(User.builder()
                .id(USER_ID)
                .tierLevel(3)
                .isDeleted(true)
                .build()));

        LeagueTierResponse response = leagueService.getMyTier(USER_ID, NOW);

        assertThat(response.assigned()).isFalse();
        verify(leagueTierConfigRepository, never()).findById(any());
    }

    @Test
    @DisplayName("내 티어 조회 - 게스트 유저 → assigned=false(온보딩 전 리그 미참가)")
    void getMyTierGuestIsUnassigned() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(User.builder()
                .id(USER_ID)
                .tierLevel(3)
                .isGuest(true)
                .build()));

        LeagueTierResponse response = leagueService.getMyTier(USER_ID, NOW);

        assertThat(response.assigned()).isFalse();
        assertThat(response.tierLevel()).isNull();
        verify(leagueTierConfigRepository, never()).findById(any());
    }

    // ── getMyRanking ──────────────────────────────────────────────────────

    @Test
    @DisplayName("내 랭킹은 category 미지정 시에도 DailyFocusStat 전역 상위 100명을 반환한다")
    void getMyRankingWithoutCategoryReturnsGlobalRanking() {
        LeagueRankingRow top = rankingRow(U2, "top", 300);
        LeagueRankingRow me = rankingRow(USER_ID, "me", 200);
        given(leagueRankingQueryRepository.findTop(any(), any(), any(), anyInt()))
                .willReturn(List.of(top, me));
        given(pinnedUserRepository.findPinnedUserIdsByUserId(USER_ID)).willReturn(Set.of(U2));

        List<LeagueMemberResponse> ranking = leagueService.getMyRanking(USER_ID, null, DATE);

        assertThat(ranking).hasSize(2);
        assertThat(ranking).extracting(LeagueMemberResponse::rank).containsExactly(1, 2);
        assertThat(ranking.get(0).isPinned()).isTrue();
        verify(leagueRankingQueryRepository).findTop(any(), any(), eq(null), eq(100));
    }

    @Test
    @DisplayName("category 미지정 랭킹 — ranked userId로 라이브 정보 1회 배치 조회해 4필드를 채운다(없는 유저는 기본값)")
    void getMyRankingWithoutCategoryFillsLiveFocusInfo() {
        LeagueRankingRow top = rankingRow(U2, "top", 300);
        LeagueRankingRow me = rankingRow(USER_ID, "me", 200);
        Instant start = Instant.parse("2026-06-24T01:00:00Z");
        given(leagueRankingQueryRepository.findTop(any(), any(), any(), anyInt()))
                .willReturn(List.of(top, me));
        given(pinnedUserRepository.findPinnedUserIdsByUserId(USER_ID)).willReturn(Set.of());
        // top(U2) 은 집중 중, me(USER_ID) 는 라이브 맵에 없음 → 기본값
        given(focusLiveInfoLookup.liveInfoByUserId(List.of(U2, USER_ID), DATE))
                .willReturn(Map.of(U2, liveInfo(42, true, start, "전공 공부")));

        List<LeagueMemberResponse> ranking = leagueService.getMyRanking(USER_ID, null, DATE);

        LeagueMemberResponse topResp = ranking.get(0);
        assertThat(topResp.isFocusing()).isTrue();
        assertThat(topResp.focusTimeMinutes()).isEqualTo(42);
        assertThat(topResp.focusStartedAt()).isEqualTo(start);
        assertThat(topResp.focusTagName()).isEqualTo("전공 공부");
        LeagueMemberResponse meResp = ranking.get(1);
        assertThat(meResp.isFocusing()).isFalse();
        assertThat(meResp.focusTimeMinutes()).isZero();
        assertThat(meResp.focusStartedAt()).isNull();
        assertThat(meResp.focusTagName()).isNull();
    }

    @Test
    @DisplayName("occupation 지정 시 같은 직군 전역 상위 100명을 조회하고 라이브 4필드를 채운다")
    void getMyRankingWithCategoryReturnsFilteredRanking() {
        LeagueRankingRow row = rankingRow(U2, "labor", 300);
        Instant start = Instant.parse("2026-06-24T02:00:00Z");
        given(leagueRankingQueryRepository.findTop(
                any(), any(), eq(Occupation.LABOR_ATTORNEY), eq(100))).willReturn(List.of(row));
        given(pinnedUserRepository.findPinnedUserIdsByUserId(USER_ID)).willReturn(Set.of());
        given(focusLiveInfoLookup.liveInfoByUserId(List.of(U2), DATE))
                .willReturn(Map.of(U2, liveInfo(15, true, start, null)));

        List<LeagueMemberResponse> ranking = leagueService.getMyRanking(USER_ID, Occupation.LABOR_ATTORNEY, DATE);

        assertThat(ranking).singleElement().satisfies(resp -> {
            assertThat(resp.nickname()).isEqualTo("labor");
            assertThat(resp.isFocusing()).isTrue();
            assertThat(resp.focusTimeMinutes()).isEqualTo(15);
            assertThat(resp.focusStartedAt()).isEqualTo(start);
            assertThat(resp.focusTagName()).isNull();
        });
    }

    @Test
    @DisplayName("전역 결과가 비어 있으면 핀·라이브 조회 없이 빈 목록을 반환한다")
    void getMyRankingEmptyDoesNotReadPins() {
        given(leagueRankingQueryRepository.findTop(any(), any(), any(), anyInt()))
                .willReturn(List.of());

        assertThat(leagueService.getMyRanking(USER_ID, null, DATE)).isEmpty();
        verify(pinnedUserRepository, never()).findPinnedUserIdsByUserId(any());
        verify(focusLiveInfoLookup, never()).liveInfoByUserId(any(), any());
    }

    // ── getGlobalRanking ──────────────────────────────────────────────────

    @Test
    @DisplayName("전역 랭킹 조회는 read model 순서대로 rank를 부여하고 라이브 필드는 스코프 밖이라 기본값이다")
    void getGlobalRanking_returnsGlobalRanking() {
        LeagueRankingRow top = rankingRow(U2, "top", 500);
        LeagueRankingRow mid = rankingRow(USER_ID, "mid", 300);
        given(leagueRankingQueryRepository.findTop(any(), any(), eq(null), eq(100)))
                .willReturn(List.of(top, mid));

        List<LeagueMemberResponse> ranking = leagueService.getGlobalRanking("total", 100);

        assertThat(ranking).hasSize(2);
        assertThat(ranking.get(0).rank()).isEqualTo(1);
        assertThat(ranking.get(0).nickname()).isEqualTo("top");
        assertThat(ranking.get(1).rank()).isEqualTo(2);
        assertThat(ranking.get(1).userId()).isEqualTo(USER_ID);
        // 전역 랭킹은 라이브 스코프 밖 — 핀·라이브 모두 기본값, 라이브 배치 조회도 하지 않는다
        assertThat(ranking).allMatch(row -> !row.isPinned()
                && !row.isFocusing() && row.focusTimeMinutes() == 0
                && row.focusStartedAt() == null && row.focusTagName() == null);
        verify(focusLiveInfoLookup, never()).liveInfoByUserId(any(), any());
    }

    @Test
    @DisplayName("전역 랭킹 조회 - scope 대소문자 무관(TOTAL) 허용")
    void getGlobalRanking_scopeCaseInsensitive() {
        given(leagueRankingQueryRepository.findTop(any(), any(), eq(null), eq(100)))
                .willReturn(List.of());

        assertThat(leagueService.getGlobalRanking("TOTAL", 100)).isEmpty();
    }

    @Test
    @DisplayName("전역 랭킹 조회 - limit 상한(500) 초과 시 클램프되어 조회는 정상 수행")
    void getGlobalRanking_limitClamped() {
        given(leagueRankingQueryRepository.findTop(any(), any(), eq(null), eq(500)))
                .willReturn(List.of());

        leagueService.getGlobalRanking("total", 100000);

        verify(leagueRankingQueryRepository).findTop(any(), any(), eq(null), eq(500));
    }

    @Test
    @DisplayName("전역 랭킹 조회 - limit 0/음수 → 최소 1로 클램프")
    void getGlobalRanking_limitMinClamped() {
        given(leagueRankingQueryRepository.findTop(any(), any(), eq(null), eq(1)))
                .willReturn(List.of());

        leagueService.getGlobalRanking("total", 0);

        verify(leagueRankingQueryRepository).findTop(any(), any(), eq(null), eq(1));
    }

    @Test
    @DisplayName("전역 랭킹 조회 - 지원하지 않는 scope → LeagueException(INVALID_SCOPE)")
    void getGlobalRanking_invalidScope() {
        assertThatThrownBy(() -> leagueService.getGlobalRanking("weekly", 100))
                .isInstanceOf(LeagueException.class)
                .extracting(e -> ((LeagueException) e).getErrorCode())
                .isEqualTo(LeagueErrorCode.INVALID_SCOPE);
    }

    // ── getMyRank ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("내 순위 조회는 전역 read model의 순위·합계를 반환한다")
    void getMyRankAssigned() {
        given(leagueRankingQueryRepository.findRankOf(eq(USER_ID), any(), any()))
                .willReturn(Optional.of(new LeagueRankingPosition(2, 3, 200)));

        LeagueRankResponse response = leagueService.getMyRank(USER_ID);

        assertThat(response.assigned()).isTrue();
        assertThat(response.myRank()).isEqualTo(2);
        assertThat(response.totalFocusSeconds()).isEqualTo(200);
    }

    @Test
    @DisplayName("비활성 또는 존재하지 않는 유저는 기존 DTO 호환을 위해 assigned=false를 반환한다")
    void getMyRankMissingReturnsUnassigned() {
        given(leagueRankingQueryRepository.findRankOf(eq(USER_ID), any(), any()))
                .willReturn(Optional.empty());

        LeagueRankResponse response = leagueService.getMyRank(USER_ID);

        assertThat(response.assigned()).isFalse();
        assertThat(response.myRank()).isNull();
    }

    @Test
    @DisplayName("내 순위 조회 시 아레나 ID 없이 전역 rank 이벤트를 발행한다")
    void getMyRankEmitsRankViewed() {
        given(leagueRankingQueryRepository.findRankOf(eq(USER_ID), any(), any()))
                .willReturn(Optional.of(new LeagueRankingPosition(2, 3, 200)));

        leagueService.getMyRank(USER_ID);

        verify(userActivityEventLogger).log(UserActivityEvent.LEAGUE_RANK_VIEWED,
                Map.of("my_rank", 2,
                        "tier_level", 3,
                        "total_focus_seconds", 200));
    }

    @Test
    @DisplayName("순위가 없는 유저는 LEAGUE_RANK_VIEWED를 발행하지 않는다")
    void getMyRankMissingDoesNotEmit() {
        given(leagueRankingQueryRepository.findRankOf(eq(USER_ID), any(), any()))
                .willReturn(Optional.empty());

        leagueService.getMyRank(USER_ID);

        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    // ── getMySchedule ─────────────────────────────────────────────────────

    @Test
    @DisplayName("스케줄 조회 - 수요일 12:00 KST → 다음 월요일 00:00 KST / remainingSeconds 정확")
    void getMyScheduleWednesdayNoon() {
        // 2026-06-24 12:00:00 KST = 2026-06-24T03:00:00Z (수요일)
        Instant now = Instant.parse("2026-06-24T03:00:00Z");
        // 다음 월요일 00:00 KST = 2026-06-29T00:00:00+09:00 = 2026-06-28T15:00:00Z
        Instant expectedReset = Instant.parse("2026-06-28T15:00:00Z");
        // 4일 12시간 = 4*86400 + 12*3600 = 388800초
        long expectedSeconds = 388800L;

        LeagueScheduleResponse response = leagueService.getMySchedule(USER_ID, now);

        assertThat(response.nextResetAt()).isEqualTo(expectedReset);
        assertThat(response.remainingSeconds()).isEqualTo(expectedSeconds);
    }

    @Test
    @DisplayName("스케줄 조회 - 월요일 00:00:00 정각 KST → 다음 주 월요일(remainingSeconds=604800)")
    void getMyScheduleMondayMidnight() {
        // 2026-06-22 00:00:00 KST = 2026-06-21T15:00:00Z (월요일 정각)
        Instant now = Instant.parse("2026-06-21T15:00:00Z");
        // 다음 월요일 00:00 KST = 2026-06-29T00:00:00+09:00 = 2026-06-28T15:00:00Z
        Instant expectedReset = Instant.parse("2026-06-28T15:00:00Z");

        LeagueScheduleResponse response = leagueService.getMySchedule(USER_ID, now);

        assertThat(response.nextResetAt()).isEqualTo(expectedReset);
        assertThat(response.remainingSeconds()).isEqualTo(604800L);
    }

    @Test
    @DisplayName("스케줄 조회 - 일요일 23:59:59 KST → 1초 남음")
    void getMyScheduleSundayLastSecond() {
        // 2026-06-28 23:59:59 KST = 2026-06-28T14:59:59Z (일요일)
        Instant now = Instant.parse("2026-06-28T14:59:59Z");
        // 다음 월요일 00:00 KST = 2026-06-29T00:00:00+09:00 = 2026-06-28T15:00:00Z
        Instant expectedReset = Instant.parse("2026-06-28T15:00:00Z");

        LeagueScheduleResponse response = leagueService.getMySchedule(USER_ID, now);

        assertThat(response.nextResetAt()).isEqualTo(expectedReset);
        assertThat(response.remainingSeconds()).isEqualTo(1L);
    }

    @Test
    @DisplayName("스케줄 조회 - remainingSeconds 항상 ≥ 0")
    void getMyScheduleRemainingSecondsNonNegative() {
        // 임의 시각에 대해 항상 ≥ 0 검증
        Instant now = Instant.parse("2026-06-25T09:30:00Z");

        LeagueScheduleResponse response = leagueService.getMySchedule(USER_ID, now);

        assertThat(response.remainingSeconds()).isGreaterThanOrEqualTo(0L);
    }

    // ── getLastResult ─────────────────────────────────────────────────────

    @Test
    @DisplayName("주간 마감 결과 조회 - 결과 있음·미확인 → hasResult=true, acknowledged=false, 전체 필드 매핑")
    void getLastResultUnacknowledged() {
        given(leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(USER_ID))
                .willReturn(Optional.of(weeklyResult(PREVIOUS_WEEK_START, LeagueWeeklyResultType.PROMOTED)));
        given(currencyTransactionRepository.existsByIdempotencyKey(
                "league:" + PREVIOUS_WEEK_START + ":" + USER_ID)).willReturn(true);

        LeagueLastResultResponse response = leagueService.getLastResult(USER_ID);

        assertThat(response.hasResult()).isTrue();
        assertThat(response.weekStartAt()).isEqualTo(PREVIOUS_WEEK_START);
        assertThat(response.result()).isEqualTo("PROMOTED");
        assertThat(response.previousTierLevel()).isEqualTo(2);
        assertThat(response.newTierLevel()).isEqualTo(3);
        assertThat(response.focusSeconds()).isEqualTo(200);
        assertThat(response.acknowledged()).isFalse();
        // 승급 보너스는 원장에 실제 지급(멱등키)이 있을 때만 보고 — tier 3 도달 → +100
        assertThat(response.promotionBonusCoins()).isEqualTo(100);
    }

    @Test
    @DisplayName("주간 마감 결과 조회 - 결과 있음·확인됨(acknowledgedAt!=null) → acknowledged=true")
    void getLastResultAcknowledged() {
        LeagueWeeklyResult acked = LeagueWeeklyResult.builder()
                .weekStartAt(PREVIOUS_WEEK_START)
                .previousTierLevel(2)
                .newTierLevel(3)
                .result(LeagueWeeklyResultType.STAY)
                .focusSeconds(200)
                .acknowledgedAt(NOW)
                .build();
        given(leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(USER_ID))
                .willReturn(Optional.of(acked));

        LeagueLastResultResponse response = leagueService.getLastResult(USER_ID);

        assertThat(response.hasResult()).isTrue();
        assertThat(response.result()).isEqualTo("STAY");
        assertThat(response.acknowledged()).isTrue();
    }

    @Test
    @DisplayName("주간 마감 결과 조회 - 결과 행 없음(미배정/신규) → hasResult=false, 나머지 null/false")
    void getLastResultNone() {
        given(leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(USER_ID))
                .willReturn(Optional.empty());

        LeagueLastResultResponse response = leagueService.getLastResult(USER_ID);

        assertThat(response.hasResult()).isFalse();
        assertThat(response.weekStartAt()).isNull();
        assertThat(response.result()).isNull();
        assertThat(response.previousTierLevel()).isNull();
        assertThat(response.newTierLevel()).isNull();
        assertThat(response.focusSeconds()).isNull();
        assertThat(response.acknowledged()).isFalse();
    }

    // ── acknowledgeLastResult ─────────────────────────────────────────────
    // 멱등·선점·주차 고정의 실제 동작은 조건부 UPDATE 라 리포지토리 통합 테스트(LeagueWeeklyResultRepositoryTest)에서
    // 검증한다. 서비스는 (userId, weekStartAt, now) 를 그대로 위임하는 얇은 계층이므로 위임만 확인한다.

    @Test
    @DisplayName("주간 마감 결과 확인 - GET 으로 받은 weekStartAt 을 고정해 (userId, weekStartAt, now) 조건부 UPDATE 로 위임")
    void acknowledgeLastResultDelegatesToConditionalUpdate() {
        leagueService.acknowledgeLastResult(USER_ID, PREVIOUS_WEEK_START, NOW);

        verify(leagueWeeklyResultRepository).acknowledge(USER_ID, PREVIOUS_WEEK_START, NOW);
    }
}

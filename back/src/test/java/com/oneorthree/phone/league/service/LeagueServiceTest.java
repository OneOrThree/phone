package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueMemberResult;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;

@ExtendWith(MockitoExtension.class)
class LeagueServiceTest {

    @InjectMocks
    private LeagueService leagueService;

    @Mock
    private LeagueArenaUserRepository leagueArenaUserRepository;

    @Mock
    private LeagueTierConfigRepository leagueTierConfigRepository;

    private LeagueTierConfig tierConfig(int tierLevel, String badgeId) {
        return LeagueTierConfig.builder()
                .tierLevel(tierLevel)
                .badgeId(badgeId)
                .build();
    }

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID U2 = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID U3 = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final UUID ARENA_ID = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
    private static final Instant WEEK_START = Instant.parse("2026-06-22T00:00:00Z");

    private LeagueArena activeArena() {
        return LeagueArena.builder()
                .id(ARENA_ID)
                .weekStartAt(WEEK_START)
                .status(LeagueArenaStatus.ACTIVE)
                .build();
    }

    private LeagueArenaUser member(UUID userId, String nickname, LeagueArena arena, int focusMinutes) {
        User user = User.builder().id(userId).nickname(nickname).build();
        return LeagueArenaUser.builder()
                .id(UUID.randomUUID())
                .user(user)
                .leagueArena(arena)
                .tierLevel(3)
                .totalFocusMinutes(focusMinutes)
                .build();
    }

    // ── getMyTier ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("내 티어 조회 성공 → ACTIVE 아레나 정보 매핑")
    void getMyTierAssigned() {
        LeagueArena arena = activeArena();
        LeagueArenaUser me = member(USER_ID, "me", arena, 300);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        given(leagueTierConfigRepository.findById(3))
                .willReturn(Optional.of(tierConfig(3, "hyperfocus")));

        LeagueTierResponse response = leagueService.getMyTier(USER_ID);

        assertThat(response.assigned()).isTrue();
        assertThat(response.tierLevel()).isEqualTo(3);
        assertThat(response.arenaId()).isEqualTo(ARENA_ID);
        assertThat(response.weekStartAt()).isEqualTo(WEEK_START);
        assertThat(response.status()).isEqualTo("ACTIVE");
        assertThat(response.badgeId()).isEqualTo("hyperfocus");
    }

    @Test
    @DisplayName("내 티어 조회 - 티어 설정 누락 → badgeId=null 로 방어")
    void getMyTierBadgeConfigMissing() {
        LeagueArena arena = activeArena();
        LeagueArenaUser me = member(USER_ID, "me", arena, 300);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        given(leagueTierConfigRepository.findById(3))
                .willReturn(Optional.empty());

        LeagueTierResponse response = leagueService.getMyTier(USER_ID);

        assertThat(response.assigned()).isTrue();
        assertThat(response.badgeId()).isNull();
    }

    @Test
    @DisplayName("내 티어 조회 - 미배정 → assigned=false")
    void getMyTierUnassigned() {
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        LeagueTierResponse response = leagueService.getMyTier(USER_ID);

        assertThat(response.assigned()).isFalse();
        assertThat(response.tierLevel()).isNull();
        assertThat(response.arenaId()).isNull();
        assertThat(response.badgeId()).isNull();
    }

    // ── getMyRanking ──────────────────────────────────────────────────────

    @Test
    @DisplayName("랭킹 조회(category=null) → 정렬 순서대로 rank 1..N 부여 (기존 아레나 동작)")
    void getMyRankingAssigned() {
        LeagueArena arena = activeArena();
        LeagueArenaUser me = member(USER_ID, "me", arena, 200);
        LeagueArenaUser top = member(U2, "top", arena, 300);
        LeagueArenaUser last = member(U3, "last", arena, 100);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        // findRankedByArena 가 이미 정렬된 리스트를 반환한다고 가정 (top > me > last)
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(top, me, last));

        List<LeagueMemberResponse> ranking = leagueService.getMyRanking(USER_ID, null);

        assertThat(ranking).hasSize(3);
        assertThat(ranking.get(0).rank()).isEqualTo(1);
        assertThat(ranking.get(0).nickname()).isEqualTo("top");
        assertThat(ranking.get(0).totalFocusMinutes()).isEqualTo(300);
        assertThat(ranking.get(1).rank()).isEqualTo(2);
        assertThat(ranking.get(1).userId()).isEqualTo(USER_ID);
        assertThat(ranking.get(2).rank()).isEqualTo(3);
        assertThat(ranking.get(0).result()).isNull();
    }

    @Test
    @DisplayName("랭킹 조회(category=null) - 미배정 → 빈 리스트")
    void getMyRankingUnassigned() {
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        assertThat(leagueService.getMyRanking(USER_ID, null)).isEmpty();
    }

    @Test
    @DisplayName("랭킹 조회(category 지정) → 전역 같은 과목 랭킹, 다른 아레나 유저도 포함, rank 1부터 재부여")
    void getMyRankingWithCategory_returnsGlobalRanking() {
        LeagueArena arena = activeArena();
        LeagueArenaUser top = member(U2, "top", arena, 300);
        LeagueArenaUser me = member(USER_ID, "me", arena, 200);
        // findRankedByActiveArenasAndOccupation 이 이미 정렬된 전역 목록을 반환한다고 가정
        given(leagueArenaUserRepository.findRankedByActiveArenasAndOccupation(
                eq(Occupation.LABOR_ATTORNEY), any(Pageable.class)))
                .willReturn(List.of(top, me));

        List<LeagueMemberResponse> ranking = leagueService.getMyRanking(USER_ID, Occupation.LABOR_ATTORNEY);

        assertThat(ranking).hasSize(2);
        assertThat(ranking.get(0).rank()).isEqualTo(1);
        assertThat(ranking.get(0).nickname()).isEqualTo("top");
        assertThat(ranking.get(1).rank()).isEqualTo(2);
        assertThat(ranking.get(1).userId()).isEqualTo(USER_ID);
    }

    @Test
    @DisplayName("랭킹 조회(category 지정) - 미배정 유저도 전역 랭킹은 정상 반환(본인 목록에 없음)")
    void getMyRankingUnassignedWithCategory_returnsGlobalRanking() {
        LeagueArena arena = activeArena();
        LeagueArenaUser other = member(U2, "other", arena, 500);
        given(leagueArenaUserRepository.findRankedByActiveArenasAndOccupation(
                eq(Occupation.UNIVERSITY), any(Pageable.class)))
                .willReturn(List.of(other));

        // 미배정 유저가 category 지정으로 호출해도 전역 랭킹 반환
        List<LeagueMemberResponse> ranking = leagueService.getMyRanking(USER_ID, Occupation.UNIVERSITY);

        assertThat(ranking).hasSize(1);
        assertThat(ranking.get(0).rank()).isEqualTo(1);
        assertThat(ranking.get(0).nickname()).isEqualTo("other");
    }

    // ── getMyRank ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("내 순위 조회 → 정렬 리스트에서 내 위치 = myRank, 진행 중 result=null")
    void getMyRankAssigned() {
        LeagueArena arena = activeArena();
        LeagueArenaUser me = member(USER_ID, "me", arena, 200);
        LeagueArenaUser top = member(U2, "top", arena, 300);
        LeagueArenaUser last = member(U3, "last", arena, 100);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(top, me, last));

        LeagueRankResponse response = leagueService.getMyRank(USER_ID);

        assertThat(response.assigned()).isTrue();
        assertThat(response.myRank()).isEqualTo(2);
        assertThat(response.totalFocusMinutes()).isEqualTo(200);
        assertThat(response.result()).isNull();
    }

    @Test
    @DisplayName("내 순위 조회 - 확정된 result 매핑")
    void getMyRankWithResult() {
        LeagueArena arena = activeArena();
        LeagueArenaUser me = member(USER_ID, "me", arena, 300);
        me.setRank(1);
        me.setResult(LeagueMemberResult.PROMOTED);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(me));

        LeagueRankResponse response = leagueService.getMyRank(USER_ID);

        assertThat(response.myRank()).isEqualTo(1);
        assertThat(response.result()).isEqualTo("PROMOTED");
    }

    @Test
    @DisplayName("내 순위 조회 - 정합성 깨짐(랭킹 목록에 내가 없음) → IllegalStateException")
    void getMyRankMemberNotInRanked() {
        LeagueArena arena = activeArena();
        LeagueArenaUser me = member(USER_ID, "me", arena, 200);
        LeagueArenaUser other = member(U2, "other", arena, 300);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(other)); // 내 멤버가 랭킹 목록에 없음

        assertThatThrownBy(() -> leagueService.getMyRank(USER_ID))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("내 순위 조회 - 미배정 → assigned=false")
    void getMyRankUnassigned() {
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        LeagueRankResponse response = leagueService.getMyRank(USER_ID);

        assertThat(response.assigned()).isFalse();
        assertThat(response.myRank()).isNull();
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
}

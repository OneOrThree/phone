package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueMemberResult;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LeagueBatchServiceTest extends RepositoryTestBase {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 배치 실행 시각: 2026-06-29(월) 00:00 KST — 새 주차 시작 시점
    private static final Instant BATCH_NOW =
            ZonedDateTime.of(2026, 6, 29, 0, 0, 0, 0, KST).toInstant();
    // 지난 주차 시작: 2026-06-22(월) 00:00 KST
    private static final Instant LAST_WEEK_START =
            ZonedDateTime.of(2026, 6, 22, 0, 0, 0, 0, KST).toInstant();

    @Autowired
    LeagueBatchService leagueBatchService;
    @Autowired
    LeagueArenaRepository leagueArenaRepository;
    @Autowired
    LeagueArenaUserRepository leagueArenaUserRepository;
    @Autowired
    LeagueTierConfigRepository leagueTierConfigRepository;
    @Autowired
    UserRepository userRepository;

    private LeagueTierConfig saveTierConfig(int level, int arenaSize, int promote, int relegate, int warning) {
        return leagueTierConfigRepository.save(LeagueTierConfig.builder()
                .tierLevel(level).arenaSize(arenaSize)
                .promoteCount(promote).relegateCount(relegate).relegateWarningCount(warning)
                .badgeId("tier-" + level).build());
    }

    private LeagueArena saveActiveArena(LeagueTierConfig cfg) {
        return leagueArenaRepository.save(LeagueArena.builder()
                .tierConfig(cfg).weekStartAt(LAST_WEEK_START).status(LeagueArenaStatus.ACTIVE).build());
    }

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).currentTier(1).build());
    }

    private LeagueArenaUser saveMember(LeagueArena arena, User user, int focusMinutes) {
        return leagueArenaUserRepository.save(LeagueArenaUser.builder()
                .user(user).leagueArena(arena).tierLevel(arena.getTierConfig().getTierLevel())
                .totalFocusMinutes(focusMinutes).build());
    }

    private LeagueArenaUser saveMember(LeagueArena arena, String nickname, int focusMinutes) {
        return saveMember(arena, saveUser(nickname), focusMinutes);
    }

    private List<LeagueArena> activeArenasOfTier(int tierLevel) {
        return leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE).stream()
                .filter(arena -> arena.getTierConfig().getTierLevel() == tierLevel)
                .toList();
    }

    private Set<UUID> memberUserIds(LeagueArena arena) {
        return leagueArenaUserRepository.findRankedByArena(arena).stream()
                .map(m -> m.getUser().getId())
                .collect(Collectors.toSet());
    }

    // ── (1) 주간 랭킹 산정 ────────────────────────────────────────────────

    @Test
    @DisplayName("랭킹 산정 — totalFocusMinutes 내림차순으로 rank 1..N 확정 (저장 순서 무관)")
    void settleRanking_orderByMinutesDesc() {
        saveTierConfig(1, 30, 1, 1, 1);
        LeagueTierConfig cfg2 = saveTierConfig(2, 30, 1, 1, 1);
        saveTierConfig(3, 30, 1, 1, 1);
        LeagueArena arena = saveActiveArena(cfg2);
        // 저장 순서를 섞어 정렬이 minutes 기준임을 보장
        LeagueArenaUser m100 = saveMember(arena, "m100", 100);
        LeagueArenaUser m300 = saveMember(arena, "m300", 300);
        LeagueArenaUser m50 = saveMember(arena, "m50", 50);
        LeagueArenaUser m200 = saveMember(arena, "m200", 200);

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(m300.getRank()).isEqualTo(1);
        assertThat(m200.getRank()).isEqualTo(2);
        assertThat(m100.getRank()).isEqualTo(3);
        assertThat(m50.getRank()).isEqualTo(4);
    }

    @Test
    @DisplayName("랭킹 산정 — 동점은 id 오름차순으로 순위 결정(결정적 tiebreak)")
    void settleRanking_tieBreakByIdAsc() {
        LeagueTierConfig cfg = saveTierConfig(1, 30, 0, 0, 0);
        LeagueArena arena = saveActiveArena(cfg);
        LeagueArenaUser a = saveMember(arena, "a", 150);
        LeagueArenaUser b = saveMember(arena, "b", 150);
        List<UUID> expectedOrder = Stream.of(a.getId(), b.getId()).sorted().toList();

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        LeagueArenaUser first = a.getId().equals(expectedOrder.get(0)) ? a : b;
        LeagueArenaUser second = first == a ? b : a;
        assertThat(first.getRank()).isEqualTo(1);
        assertThat(second.getRank()).isEqualTo(2);
    }

    // ── (2) 승격/강등 컷오프 분할 ─────────────────────────────────────────

    @Test
    @DisplayName("컷오프 분할 — 상위 promoteCount=PROMOTED, 하위 relegateCount=RELEGATED, 그 위 warning, 나머지 STAY")
    void decideResults_cutoffSplit() {
        saveTierConfig(1, 30, 2, 1, 1);
        LeagueTierConfig cfg2 = saveTierConfig(2, 30, 2, 2, 1);
        saveTierConfig(3, 30, 0, 2, 1);
        LeagueArena arena = saveActiveArena(cfg2);
        // 정원(30) 미달 아레나(6명)에서도 컷오프가 정확히 적용돼야 한다
        LeagueArenaUser r1 = saveMember(arena, "r1", 600);
        LeagueArenaUser r2 = saveMember(arena, "r2", 500);
        LeagueArenaUser r3 = saveMember(arena, "r3", 400);
        LeagueArenaUser r4 = saveMember(arena, "r4", 300);
        LeagueArenaUser r5 = saveMember(arena, "r5", 200);
        LeagueArenaUser r6 = saveMember(arena, "r6", 100);

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(r1.getResult()).isEqualTo(LeagueMemberResult.PROMOTED);
        assertThat(r2.getResult()).isEqualTo(LeagueMemberResult.PROMOTED);
        assertThat(r3.getResult()).isEqualTo(LeagueMemberResult.STAY);
        assertThat(r4.getResult()).isEqualTo(LeagueMemberResult.RELEGATE_WARNING);
        assertThat(r5.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
        assertThat(r6.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
        assertThat(summary.endedArenaCount()).isEqualTo(1);
        assertThat(summary.settledMemberCount()).isEqualTo(6);
    }

    @Test
    @DisplayName("컷오프 겹침(멤버 수 < promote+warning+relegate) — 승격이 우선, 남는 하위만 강등")
    void decideResults_overlappingZonesPromotionFirst() {
        saveTierConfig(1, 30, 2, 2, 2);
        LeagueTierConfig cfg2 = saveTierConfig(2, 30, 2, 2, 2);
        saveTierConfig(3, 30, 0, 2, 2);
        LeagueArena arena = saveActiveArena(cfg2);
        LeagueArenaUser r1 = saveMember(arena, "r1", 400);
        LeagueArenaUser r2 = saveMember(arena, "r2", 300);
        LeagueArenaUser r3 = saveMember(arena, "r3", 200);
        LeagueArenaUser r4 = saveMember(arena, "r4", 100);

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        // 승격 zone(2) 먼저 확정 → 나머지 2명이 강등 zone, warning zone 은 밀려서 소멸
        assertThat(r1.getResult()).isEqualTo(LeagueMemberResult.PROMOTED);
        assertThat(r2.getResult()).isEqualTo(LeagueMemberResult.PROMOTED);
        assertThat(r3.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
        assertThat(r4.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
    }

    // ── (3) 활동 0분 무조건 강등 ──────────────────────────────────────────

    @Test
    @DisplayName("활동 0분 — 순위 무관 무조건 RELEGATED, 0분 제외 후 나머지에 컷오프 적용")
    void zeroActivity_forcedRelegationAndCutoffOnActives() {
        saveTierConfig(1, 30, 1, 1, 0);
        LeagueTierConfig cfg2 = saveTierConfig(2, 30, 1, 1, 0);
        saveTierConfig(3, 30, 0, 1, 0);
        LeagueArena arena = saveActiveArena(cfg2);
        LeagueArenaUser a = saveMember(arena, "a", 300);
        LeagueArenaUser b = saveMember(arena, "b", 200);
        LeagueArenaUser c = saveMember(arena, "c", 100);
        LeagueArenaUser zero1 = saveMember(arena, "zero1", 0);
        LeagueArenaUser zero2 = saveMember(arena, "zero2", 0);

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        // 0분 유저는 랭킹과 무관하게 강등
        assertThat(zero1.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
        assertThat(zero2.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
        // 컷오프는 활동 유저 3명에게만 적용: 1위 승격, 활동 최하위(c)만 강등
        assertThat(a.getResult()).isEqualTo(LeagueMemberResult.PROMOTED);
        assertThat(b.getResult()).isEqualTo(LeagueMemberResult.STAY);
        assertThat(c.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
        // 0분 유저도 rank 는 부여된다(뒤 순위)
        assertThat(zero1.getRank()).isIn(4, 5);
        assertThat(zero2.getRank()).isIn(4, 5);
        // 다음 주 재배정: a→3티어, b→2티어, c·zero1·zero2→1티어
        assertThat(memberUserIds(activeArenasOfTier(3).get(0)))
                .containsExactly(a.getUser().getId());
        assertThat(memberUserIds(activeArenasOfTier(2).get(0)))
                .containsExactly(b.getUser().getId());
        assertThat(memberUserIds(activeArenasOfTier(1).get(0)))
                .containsExactlyInAnyOrder(c.getUser().getId(), zero1.getUser().getId(), zero2.getUser().getId());
    }

    // ── (4) 최상위/최하위 티어 경계 ───────────────────────────────────────

    @Test
    @DisplayName("최상위 티어 — PROMOTED 없음(승격 대상은 STAY 로 유지)")
    void topTier_noPromotion() {
        saveTierConfig(1, 30, 2, 1, 0);
        saveTierConfig(2, 30, 2, 1, 0);
        LeagueTierConfig cfg3 = saveTierConfig(3, 30, 2, 1, 0);
        LeagueArena arena = saveActiveArena(cfg3);
        LeagueArenaUser a = saveMember(arena, "a", 300);
        LeagueArenaUser b = saveMember(arena, "b", 200);
        LeagueArenaUser c = saveMember(arena, "c", 100);

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(List.of(a, b, c)).extracting(LeagueArenaUser::getResult)
                .doesNotContain(LeagueMemberResult.PROMOTED);
        assertThat(a.getResult()).isEqualTo(LeagueMemberResult.STAY);
        assertThat(b.getResult()).isEqualTo(LeagueMemberResult.STAY);
        assertThat(c.getResult()).isEqualTo(LeagueMemberResult.RELEGATED);
        // a, b 는 3티어 유지, c 는 2티어로 강등
        assertThat(memberUserIds(activeArenasOfTier(3).get(0)))
                .containsExactlyInAnyOrder(a.getUser().getId(), b.getUser().getId());
        assertThat(memberUserIds(activeArenasOfTier(2).get(0)))
                .containsExactly(c.getUser().getId());
    }

    @Test
    @DisplayName("최하위 티어 — RELEGATED 없음(강등 대상·0분 유저 모두 티어 유지)")
    void bottomTier_noRelegation() {
        LeagueTierConfig cfg1 = saveTierConfig(1, 30, 1, 1, 1);
        saveTierConfig(2, 30, 1, 1, 1);
        LeagueArena arena = saveActiveArena(cfg1);
        LeagueArenaUser a = saveMember(arena, "a", 300);
        LeagueArenaUser b = saveMember(arena, "b", 200);
        LeagueArenaUser c = saveMember(arena, "c", 100);
        LeagueArenaUser zero = saveMember(arena, "zero", 0);

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(List.of(a, b, c, zero)).extracting(LeagueArenaUser::getResult)
                .doesNotContain(LeagueMemberResult.RELEGATED);
        assertThat(a.getResult()).isEqualTo(LeagueMemberResult.PROMOTED);
        assertThat(b.getResult()).isEqualTo(LeagueMemberResult.RELEGATE_WARNING);
        assertThat(c.getResult()).isEqualTo(LeagueMemberResult.STAY);
        assertThat(zero.getResult()).isEqualTo(LeagueMemberResult.STAY);
        // b, c, zero 는 1티어 유지 (더 내려갈 곳 없음)
        assertThat(memberUserIds(activeArenasOfTier(1).get(0)))
                .containsExactlyInAnyOrder(b.getUser().getId(), c.getUser().getId(), zero.getUser().getId());
    }

    // ── (5) 상태 전이 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("상태 전이 — 기존 아레나 ENDED·endedAt 설정, 새 아레나 ACTIVE·weekStartAt=이번 주 월요일 00:00 KST")
    void stateTransition_endedAndNewActive() {
        LeagueTierConfig cfg = saveTierConfig(1, 30, 0, 0, 0);
        LeagueArena arena = saveActiveArena(cfg);
        saveMember(arena, "a", 100);

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(arena.getStatus()).isEqualTo(LeagueArenaStatus.ENDED);
        assertThat(arena.getEndedAt()).isEqualTo(BATCH_NOW);
        List<LeagueArena> actives = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE);
        assertThat(actives).hasSize(1);
        assertThat(actives.get(0).getWeekStartAt()).isEqualTo(BATCH_NOW);
        assertThat(actives.get(0).getEndedAt()).isNull();
        assertThat(summary.weekStartAt()).isEqualTo(BATCH_NOW);
        assertThat(summary.createdArenaCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("비월요일 실행 — resolveWeekStart 가 이전 월요일 00:00 KST 를 새 아레나 weekStartAt 으로 설정")
    void nonMonday_weekStartAt_isPreviousMonday() {
        // 수요일 15:30 KST(2026-07-01) 에 배치 실행 — resolveWeekStart 가 nextOrSame 으로 회귀하면 다음 월요일이 세팅돼 실패
        Instant wednesdayNow = ZonedDateTime.of(2026, 7, 1, 15, 30, 0, 0, KST).toInstant();
        LeagueTierConfig cfg = saveTierConfig(1, 30, 0, 0, 0);
        LeagueArena arena = saveActiveArena(cfg);
        saveMember(arena, "a", 100);

        leagueBatchService.runWeeklyBatch(wednesdayNow);

        List<LeagueArena> actives = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE);
        assertThat(actives).hasSize(1);
        // 새 아레나의 weekStartAt 은 "다음 주 월요일"이 아닌 이번 주 월요일 00:00 KST(BATCH_NOW) 이어야 한다
        assertThat(actives.get(0).getWeekStartAt()).isEqualTo(BATCH_NOW);
    }

    // ── (6) 0 리셋(신규 row) + 이력 보존 ─────────────────────────────────

    @Test
    @DisplayName("0 리셋 — 새 주차 멤버는 신규 row(totalFocusMinutes=0, rank=null, result=null), 기존 row 는 이력 보존")
    void zeroReset_newRowsAndHistoryPreserved() {
        LeagueTierConfig cfg = saveTierConfig(1, 30, 0, 0, 0);
        LeagueArena arena = saveActiveArena(cfg);
        LeagueArenaUser old = saveMember(arena, "a", 250);

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        // 기존 row: ENDED 아레나에 rank/result/누적분 그대로 보존
        assertThat(old.getLeagueArena().getId()).isEqualTo(arena.getId());
        assertThat(old.getTotalFocusMinutes()).isEqualTo(250);
        assertThat(old.getRank()).isEqualTo(1);
        assertThat(old.getResult()).isEqualTo(LeagueMemberResult.STAY);
        // 신규 row: 0 리셋
        LeagueArena newArena = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE).get(0);
        List<LeagueArenaUser> newMembers = leagueArenaUserRepository.findRankedByArena(newArena);
        assertThat(newMembers).hasSize(1);
        LeagueArenaUser fresh = newMembers.get(0);
        assertThat(fresh.getId()).isNotEqualTo(old.getId());
        assertThat(fresh.getUser().getId()).isEqualTo(old.getUser().getId());
        assertThat(fresh.getTotalFocusMinutes()).isZero();
        assertThat(fresh.getRank()).isNull();
        assertThat(fresh.getResult()).isNull();
        assertThat(fresh.getTierLevel()).isEqualTo(1);
    }

    // ── (7) 재배정 — arenaSize 순차 분할 ─────────────────────────────────

    @Test
    @DisplayName("재배정 — 티어별 편입 풀을 arenaSize 단위로 순차 분할, 마지막 아레나 정원 미달 허용")
    void reassignment_chunksByArenaSize() {
        // 2티어 arenaSize=2, 두 아레나의 유지자 5명이 한 풀로 모여 2/2/1 로 분할
        saveTierConfig(1, 2, 0, 0, 0);
        LeagueTierConfig cfg2 = saveTierConfig(2, 2, 0, 0, 0);
        LeagueArena arenaA = saveActiveArena(cfg2);
        LeagueArena arenaB = saveActiveArena(cfg2);
        saveMember(arenaA, "a1", 100);
        saveMember(arenaA, "a2", 90);
        saveMember(arenaA, "a3", 80);
        saveMember(arenaB, "b1", 70);
        saveMember(arenaB, "b2", 60);

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        List<LeagueArena> newArenas = activeArenasOfTier(2);
        assertThat(newArenas).hasSize(3);
        List<Integer> sizes = newArenas.stream()
                .map(a -> leagueArenaUserRepository.findRankedByArena(a).size())
                .sorted().toList();
        assertThat(sizes).containsExactly(1, 2, 2);
        assertThat(summary.endedArenaCount()).isEqualTo(2);
        assertThat(summary.createdArenaCount()).isEqualTo(3);
    }

    // ── (8) idempotency ──────────────────────────────────────────────────

    @Test
    @DisplayName("idempotency — 같은 주차 재실행 시 BATCH_ALREADY_RUN, 중복 마감/아레나 생성 없음")
    void idempotency_rerunThrowsWithoutDuplicates() {
        LeagueTierConfig cfg = saveTierConfig(1, 30, 0, 0, 0);
        LeagueArena arena = saveActiveArena(cfg);
        saveMember(arena, "a", 100);

        leagueBatchService.runWeeklyBatch(BATCH_NOW);
        long arenaCountAfterFirst = leagueArenaRepository.count();
        long memberCountAfterFirst = leagueArenaUserRepository.count();

        assertThatThrownBy(() -> leagueBatchService.runWeeklyBatch(BATCH_NOW))
                .isInstanceOf(LeagueException.class)
                .extracting(e -> ((LeagueException) e).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_ALREADY_RUN);
        assertThat(leagueArenaRepository.count()).isEqualTo(arenaCountAfterFirst);
        assertThat(leagueArenaUserRepository.count()).isEqualTo(memberCountAfterFirst);
    }

    @Test
    @DisplayName("배치 대상 없음(ACTIVE 아레나 0개) — 예외 없이 0 건 요약 반환")
    void noActiveArenas_returnsZeroSummary() {
        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(summary.endedArenaCount()).isZero();
        assertThat(summary.settledMemberCount()).isZero();
        assertThat(summary.createdArenaCount()).isZero();
    }

    // ── (9) 티어 설정 누락 ────────────────────────────────────────────────

    @Test
    @DisplayName("티어 설정 누락 — 재배정 대상 티어 config 가 없으면 TIER_CONFIG_NOT_FOUND")
    void tierConfigMissing_throws() {
        saveTierConfig(1, 30, 0, 0, 0);
        LeagueTierConfig cfg2 = saveTierConfig(2, 30, 1, 0, 0);
        saveTierConfig(4, 30, 0, 0, 0); // 3티어 누락 상태에서 최상위=4
        LeagueArena arena = saveActiveArena(cfg2);
        saveMember(arena, "a", 100); // 1위 → 3티어 승격 대상이지만 config 없음

        assertThatThrownBy(() -> leagueBatchService.runWeeklyBatch(BATCH_NOW))
                .isInstanceOf(LeagueException.class)
                .extracting(e -> ((LeagueException) e).getErrorCode())
                .isEqualTo(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
    }
}

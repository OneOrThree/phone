package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.stats.repository.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.service.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 리그 주간 정산 배치 × 회원탈퇴 레이스 통합 테스트 (GROMO-1218) — 정산 도중 탈퇴가 커밋돼도
 * 배치가 전체 롤백되지 않고, 탈퇴자는 skip, 나머지는 정산되는지를 실 DB 로 고정한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@code GroupBetCancelWithdrawIntegrationTest} 와
 * 같다 — 레이스 시나리오는 커밋(별도 스레드의 별도 트랜잭션)을 전제한다. 테스트 데이터는
 * {@code @AfterEach} 에서 직접 지운다. 배치 시각은 다른 테스트의 anchor 주차와 겹치지 않게
 * 먼 미래(2031년)로 둔다 — anchor 는 커밋되므로 주차가 겹치면 남의 테스트가 BATCH_ALREADY_RUN 을 맞는다.
 */
class LeagueBatchWithdrawIntegrationTest extends IntegrationTestBase {

    private static final Instant BATCH_NOW = Instant.parse("2031-07-13T15:00:00Z");
    private static final int TIER_ONE_PROMOTION_SECONDS = 50_400;

    @Autowired
    LeagueBatchService leagueBatchService;
    @Autowired
    LeagueUserSettler leagueUserSettler;
    @Autowired
    LeagueWeek leagueWeek;
    @Autowired
    UserService userService;
    @Autowired
    LeagueArenaRepository leagueArenaRepository;
    @Autowired
    LeagueTierConfigRepository leagueTierConfigRepository;
    @Autowired
    LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;

    private final List<User> users = new ArrayList<>();
    private final List<DailyFocusStat> stats = new ArrayList<>();

    @BeforeEach
    void saveTierConfigs() {
        List<String> badges = List.of("bbosirae", "preheat", "hyperfocus", "gatsaeng", "conqueror");
        for (int tierLevel = 1; tierLevel <= badges.size(); tierLevel++) {
            leagueTierConfigRepository.save(LeagueTierConfig.builder()
                    .tierLevel(tierLevel)
                    .badgeId(badges.get(tierLevel - 1))
                    .promotionTime(tierLevel * TIER_ONE_PROMOTION_SECONDS)
                    .relegationTime((tierLevel - 1) * TIER_ONE_PROMOTION_SECONDS)
                    .build());
        }
    }

    @AfterEach
    void tearDown() {
        Set<UUID> userIds = users.stream().map(User::getId).collect(Collectors.toSet());
        leagueWeeklyResultRepository.findAll().stream()
                .filter(result -> userIds.contains(result.getUser().getId()))
                .forEach(leagueWeeklyResultRepository::delete);
        users.forEach(user -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user)));
        // withdraw 가 stat 의 user 를 null 로 익명화해도 행은 남는다 — id 로 직접 지운다.
        stats.forEach(stat -> dailyFocusStatRepository.deleteById(stat.getId()));
        users.forEach(user -> userWalletRepository.findById(user.getId())
                .ifPresent(userWalletRepository::delete));
        userIds.forEach(userRepository::deleteById);
        // 이 테스트 주차의 anchor 만 지운다 (rotate 가 커밋하므로 롤백되지 않는다).
        Instant newWeekStart = leagueWeek.currentWeekStart(BATCH_NOW);
        leagueArenaRepository.findAll().stream()
                .filter(arena -> newWeekStart.equals(arena.getStartedAt()))
                .forEach(leagueArenaRepository::delete);
        leagueTierConfigRepository.deleteAllById(List.of(1, 2, 3, 4, 5));

        users.clear();
        stats.clear();
    }

    @Test
    @DisplayName("집계 후 탈퇴가 먼저 커밋된 유저 — settler 는 예외 없이 skip 하고 아무것도 쓰지 않는다")
    void settlerSkipsUserWhoseWithdrawalCommittedAfterSnapshot() {
        User leaver = saveUser("정산중탈퇴", 1);
        saveStat(leaver, leagueWeek.previousWeekStartDate(BATCH_NOW), TIER_ONE_PROMOTION_SECONDS);
        // 페이지 조회 시점 스냅샷을 재현 — 스냅샷엔 있었는데 settle 전에 탈퇴가 커밋된 상황.
        LeagueRankingRow staleRow = new LeagueRankingRow(
                leaver.getId(), leaver.getNickname(), 1, TIER_ONE_PROMOTION_SECONDS);
        userService.withdraw(leaver.getId());

        LeagueUserSettler.SettleOutcome outcome = leagueUserSettler.settle(
                staleRow, leagueWeek.previousWeekStart(BATCH_NOW), tierConfigs());

        assertThat(outcome).isEqualTo(LeagueUserSettler.SettleOutcome.SKIPPED_WITHDRAWN);
        // 결과·티어 변경·승급 보너스 어느 것도 남지 않는다.
        assertThat(leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(leaver.getId()))
                .isEmpty();
        assertThat(userRepository.findById(leaver.getId()).orElseThrow().getTierLevel()).isEqualTo(1);
        assertThat(bonusCountOf(leaver)).isZero();
    }

    @Test
    @DisplayName("배치 ↔ 탈퇴 동시 실행 — 배치는 롤백되지 않고 나머지 유저 정산과 요약 집계가 정합하다")
    void batchSurvivesConcurrentWithdrawal() throws Exception {
        User promoted = saveUser("동시승격", 1);
        User relegated = saveUser("동시강등", 2);
        User leaver = saveUser("동시탈퇴", 1);
        LocalDate previousMonday = leagueWeek.previousWeekStartDate(BATCH_NOW);
        saveStat(promoted, previousMonday, TIER_ONE_PROMOTION_SECONDS);
        // 탈퇴자도 승격 대상 — 정산이 락을 이기면 지갑이 살아 있어 보너스 credit 까지 성공해야 한다.
        saveStat(leaver, previousMonday, TIER_ONE_PROMOTION_SECONDS);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        LeagueBatchSummaryResponse summary;
        try {
            Future<LeagueBatchSummaryResponse> batchCall = pool.submit(() -> {
                await(startTogether);
                return leagueBatchService.runWeeklyBatch(BATCH_NOW);
            });
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                userService.withdraw(leaver.getId());
            });
            summary = batchCall.get(30, TimeUnit.SECONDS);
            withdrawCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // (a) 배치는 롤백되지 않았다 — anchor 가 커밋됐고 예외 없이 요약이 반환됐다.
        assertThat(leagueArenaRepository.existsByStartedAt(leagueWeek.currentWeekStart(BATCH_NOW)))
                .isTrue();
        assertThat(summary.failedMemberCount()).isZero();

        // (b) 탈퇴와 무관한 두 명은 반드시 정산됐다 — 티어 갱신·결과 저장·승급 보너스까지.
        assertResult(promoted, LeagueWeeklyResultType.PROMOTED, 2);
        assertResult(relegated, LeagueWeeklyResultType.RELEGATED, 1);
        assertThat(bonusCountOf(promoted)).isEqualTo(1);

        // (c) 탈퇴자 회계 정합 — 인터리빙은 세 가지뿐이고 어느 쪽이든 요약과 실제 기록이 맞물린다:
        //   ① 정산이 락을 이김 → settled 3명(탈퇴자 결과·보너스 있음), ② 페이지 조회엔 잡혔지만
        //   settle 전에 탈퇴 커밋 → skipped 1, ③ 페이지 조회 전에 탈퇴 커밋 → 집계에서 제외(2명뿐).
        boolean leaverSettled = leagueWeeklyResultRepository
                .findTopByUserIdOrderByCreatedAtDesc(leaver.getId()).isPresent();
        assertThat(summary.settledMemberCount()).isEqualTo(leaverSettled ? 3 : 2);
        assertThat(summary.skippedMemberCount()).isBetween(0, 1);
        if (summary.skippedMemberCount() == 1) {
            assertThat(leaverSettled).isFalse();
        }
        if (leaverSettled) {
            assertThat(bonusCountOf(leaver)).isEqualTo(1);
        }
        // 탈퇴 자체는 어느 쪽이든 완료돼 있어야 한다.
        assertThat(userRepository.findByIdAndIsDeletedFalse(leaver.getId())).isEmpty();
    }

    // ── 픽스처·헬퍼 ────────────────────────────────────────────────────

    private User saveUser(String nickname, int tierLevel) {
        User user = userRepository.save(User.builder()
                .nickname(nickname)
                .tierLevel(tierLevel)
                .isDeleted(false)
                .build());
        // 승급 보너스 credit 은 지갑을 전제로 하므로 프로덕션처럼 유저별 지갑을 함께 만든다.
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).build());
        users.add(user);
        return user;
    }

    private void saveStat(User user, LocalDate date, int seconds) {
        stats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user)
                .date(date)
                .totalFocusSeconds(seconds)
                .build()));
    }

    private Map<Integer, LeagueTierConfig> tierConfigs() {
        return leagueTierConfigRepository.findAll().stream()
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
    }

    private long bonusCountOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(transaction -> transaction.getType() == CurrencyTransactionType.LEAGUE_TIER_BONUS)
                .count();
    }

    private void assertResult(User user, LeagueWeeklyResultType expectedResult, int expectedNewTier) {
        Optional<LeagueWeeklyResult> result =
                leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(user.getId());
        assertThat(result).isPresent();
        assertThat(result.orElseThrow().getResult()).isEqualTo(expectedResult);
        assertThat(result.orElseThrow().getNewTierLevel()).isEqualTo(expectedNewTier);
        assertThat(userRepository.findById(user.getId()).orElseThrow().getTierLevel())
                .isEqualTo(expectedNewTier);
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}

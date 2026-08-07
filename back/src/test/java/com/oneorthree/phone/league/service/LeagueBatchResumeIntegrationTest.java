package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 리그 주간 정산 부분 실패 → resume 멱등 재실행 통합 테스트 (GROMO-1239) — 1차 run 에서 일부만
 * 정산되고 크래시/실패한 상황을 실 DB 로 재현해, resume 이 기정산 유저는 완료 마커로 건너뛰고
 * (티어 래칫·보너스 이중 지급 없음) 미정산 유저만 마저 정산하는지를 고정한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@code LeagueBatchWithdrawIntegrationTest} 와
 * 같다 — run/resume 은 커밋을 전제로 한 무트랜잭션 오케스트레이터다. 테스트 데이터는
 * {@code @AfterEach} 에서 직접 지운다. 배치 시각은 다른 테스트의 anchor 주차와 겹치지 않게
 * 먼 미래(2032년)로 둔다 — anchor 는 커밋되므로 주차가 겹치면 남의 테스트가 BATCH_ALREADY_RUN 을 맞는다.
 */
class LeagueBatchResumeIntegrationTest extends IntegrationTestBase {

    // 2032-07-12(월) 00:00 KST — LeagueBatchWithdrawIntegrationTest(2031년 주차)와도 겹치지 않는다.
    private static final Instant BATCH_NOW = Instant.parse("2032-07-11T15:00:00Z");
    private static final int TIER_ONE_PROMOTION_SECONDS = 50_400;

    @Autowired
    LeagueBatchService leagueBatchService;
    @Autowired
    LeagueWeek leagueWeek;
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
    @DisplayName("부분 실패 후 resume — 성공분은 불변(마커 skip), 실패분만 마저 정산된다")
    void resumeAfterPartialFailureSettlesOnlyRemainder() {
        // A 는 정상(지갑 있음), B 는 지갑을 만들지 않아 승급 보너스 credit 이 지갑 NOT_FOUND 로
        // 터진다 — settler 건별 트랜잭션이 롤백되는 실제 실패 경로로 부분 실패를 유도한다.
        User settledFirst = saveUser("재개기정산", 1, true);
        User failedFirst = saveUser("재개실패복구", 1, false);
        Instant previousWeekStart = leagueWeek.previousWeekStart(BATCH_NOW);
        saveStat(settledFirst, TIER_ONE_PROMOTION_SECONDS);
        saveStat(failedFirst, TIER_ONE_PROMOTION_SECONDS);

        LeagueBatchSummaryResponse firstRun = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(firstRun.settledMemberCount()).isEqualTo(1);
        assertThat(firstRun.failedMemberCount()).isEqualTo(1);
        assertThat(firstRun.alreadySettledMemberCount()).isZero();
        // 실패 유저는 그 유저만 롤백 — 결과·티어·보너스 어느 것도 남지 않았다.
        assertThat(leagueWeeklyResultRepository
                .findTopByUserIdOrderByCreatedAtDesc(failedFirst.getId())).isEmpty();
        assertThat(tierOf(failedFirst)).isEqualTo(1);

        // 실패 원인(지갑 부재)을 복구한 뒤 resume — 운영 복구 절차 그대로.
        userWalletRepository.save(UserWallet.builder().userId(failedFirst.getId()).build());
        LeagueBatchSummaryResponse resumed = leagueBatchService.resumeWeeklyBatch(BATCH_NOW, null);

        // 요약 정합 — 기정산 1명은 alreadySettled, 실패했던 1명만 settled, anchor 재사용.
        assertThat(resumed.settledMemberCount()).isEqualTo(1);
        assertThat(resumed.alreadySettledMemberCount()).isEqualTo(1);
        assertThat(resumed.failedMemberCount()).isZero();
        assertThat(resumed.endedArenaCount()).isZero();
        assertThat(resumed.createdArenaCount()).isZero();

        // 기정산 유저 불변 — 티어 래칫 없음(2 유지), 결과 1행, 보너스 1건(멱등키·마커 이중 방어).
        assertThat(tierOf(settledFirst)).isEqualTo(2);
        assertThat(resultCountOf(settledFirst)).isEqualTo(1);
        assertThat(bonusCountOf(settledFirst)).isEqualTo(1);

        // 실패했던 유저는 이번에 정산 완료 — 승급·결과·보너스 전부 적용.
        Optional<LeagueWeeklyResult> recovered =
                leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(failedFirst.getId());
        assertThat(recovered).isPresent();
        assertThat(recovered.orElseThrow().getResult()).isEqualTo(LeagueWeeklyResultType.PROMOTED);
        assertThat(recovered.orElseThrow().getWeekStartAt()).isEqualTo(previousWeekStart);
        assertThat(tierOf(failedFirst)).isEqualTo(2);
        assertThat(bonusCountOf(failedFirst)).isEqualTo(1);

        // 한 번 더 resume — 전원 마커 skip, 아무 변화 없음(멱등 종결 상태).
        LeagueBatchSummaryResponse third = leagueBatchService.resumeWeeklyBatch(BATCH_NOW, null);
        assertThat(third.settledMemberCount()).isZero();
        assertThat(third.alreadySettledMemberCount()).isEqualTo(2);
        assertThat(bonusCountOf(settledFirst)).isEqualTo(1);
        assertThat(bonusCountOf(failedFirst)).isEqualTo(1);
    }

    // ── 픽스처·헬퍼 ────────────────────────────────────────────────────

    private User saveUser(String nickname, int tierLevel, boolean withWallet) {
        User user = userRepository.save(User.builder()
                .nickname(nickname)
                .tierLevel(tierLevel)
                .isDeleted(false)
                .build());
        // 지갑 없는 유저 = 승급 보너스 credit 실패 유도 장치 — 부분 실패 시나리오의 핵심 픽스처다.
        if (withWallet) {
            userWalletRepository.save(UserWallet.builder().userId(user.getId()).build());
        }
        users.add(user);
        return user;
    }

    private void saveStat(User user, int seconds) {
        stats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user)
                .date(leagueWeek.previousWeekStartDate(BATCH_NOW))
                .totalFocusSeconds(seconds)
                .build()));
    }

    private int tierOf(User user) {
        return userRepository.findById(user.getId()).orElseThrow().getTierLevel();
    }

    private long resultCountOf(User user) {
        return leagueWeeklyResultRepository.findAll().stream()
                .filter(result -> result.getUser().getId().equals(user.getId()))
                .count();
    }

    private long bonusCountOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(transaction -> transaction.getType() == CurrencyTransactionType.LEAGUE_TIER_BONUS)
                .count();
    }
}

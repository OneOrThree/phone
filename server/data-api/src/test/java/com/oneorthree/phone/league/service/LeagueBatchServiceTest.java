package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.league.repository.domain.LeagueArena;
import com.oneorthree.phone.league.repository.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 리그 주간 정산 배치의 시나리오 검증 — 단, 이 테스트는 {@link RepositoryTestBase} 의 주변
 * {@code @Transactional} 안에서 돌기 때문에 {@code LeagueAnchorRotator.rotate}·
 * {@code LeagueUserSettler.settle}(전파 REQUIRED)이 테스트 트랜잭션에 <b>합류</b>한다 —
 * 프로덕션의 건별 커밋/롤백 경계는 여기서 관측할 수 없다. 그 경계(유저 단위 롤백·커밋 가시성)에
 * 의존하는 단언은 {@link LeagueBatchWithdrawIntegrationTest}(IntegrationTestBase, 주변 트랜잭션
 * 없음 — 그 클래스 자바독 참조)에 둘 것.
 */
class LeagueBatchServiceTest extends RepositoryTestBase {

    private static final Instant BATCH_NOW = Instant.parse("2026-07-12T15:00:00Z");
    private static final Instant PREVIOUS_WEEK_START = Instant.parse("2026-07-05T15:00:00Z");
    private static final LocalDate PREVIOUS_MONDAY = LocalDate.of(2026, 7, 6);
    private static final LocalDate PREVIOUS_SUNDAY = LocalDate.of(2026, 7, 12);

    // 재개(resume) 테스트 전용 먼 미래 주차 (GROMO-1239) — resume 은 가입 컷오프(주차 종료 경계
    // 이후 가입자 제외)를 걸므로, 실제 벽시계로 생성되는 픽스처 유저(created_at=지금)가 대상에
    // 남으려면 경계가 미래여야 한다. 2033-07-11(월) 00:00 KST 주차를 쓴다.
    private static final Instant RESUME_NOW = Instant.parse("2033-07-10T15:00:00Z");
    private static final Instant RESUME_PREVIOUS_WEEK_START = Instant.parse("2033-07-03T15:00:00Z");
    private static final LocalDate RESUME_PREVIOUS_MONDAY = LocalDate.of(2033, 7, 4);

    // 가입 컷오프 검증용 먼 과거 주차 — 픽스처 유저(created_at=지금)가 전원 "주차 종료 후 가입"이 된다.
    private static final Instant PAST_WEEK_START = Instant.parse("2020-07-05T15:00:00Z");
    private static final Instant PAST_WEEK_BOUNDARY = Instant.parse("2020-07-12T15:00:00Z");
    private static final LocalDate PAST_MONDAY = LocalDate.of(2020, 7, 6);

    @Autowired
    LeagueBatchService leagueBatchService;
    @Autowired
    LeagueUserSettler leagueUserSettler;
    @Autowired
    LeagueArenaRepository leagueArenaRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    LeagueTierConfigRepository leagueTierConfigRepository;
    @Autowired
    LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;

    @BeforeEach
    void saveTierConfigs() {
        List<String> badges = List.of("bbosirae", "preheat", "hyperfocus", "gatsaeng", "conqueror");
        for (int tierLevel = 1; tierLevel <= badges.size(); tierLevel++) {
            leagueTierConfigRepository.save(LeagueTierConfig.builder()
                    .tierLevel(tierLevel)
                    .badgeId(badges.get(tierLevel - 1))
                    .promotionTime(tierLevel * 50_400)
                    .relegationTime((tierLevel - 1) * 50_400)
                    .build());
        }
        leagueTierConfigRepository.flush();
    }

    @Test
    @DisplayName("1~5티어 시간 임계값 표가 정산 계약과 일치한다")
    void tierThresholdTable() {
        Map<Integer, LeagueTierConfig> configs = leagueTierConfigRepository.findAll().stream()
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));

        assertThat(configs).hasSize(5);
        assertThat(configs.get(1)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(50_400, 0);
        assertThat(configs.get(2)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(100_800, 50_400);
        assertThat(configs.get(3)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(151_200, 100_800);
        assertThat(configs.get(4)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(201_600, 151_200);
        assertThat(configs.get(5)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(252_000, 201_600);
    }

    @Test
    @DisplayName("승격은 임계값 이상, 강등은 임계값 미만이며 T1/T5 경계를 넘지 않는다")
    void thresholdBoundariesAndEdgeTiers() {
        User tierOnePromotion = saveUser("tierOnePromotion", 1, false);
        User tierOneZero = saveUser("tierOneZero", 1, false);
        User tierTwoPromotion = saveUser("tierTwoPromotion", 2, false);
        User relegationEquality = saveUser("relegationEquality", 3, false);
        User belowRelegation = saveUser("belowRelegation", 3, false);
        User tierFive = saveUser("tierFive", 5, false);
        User tierTwoZero = saveUser("tierTwoZero", 2, false);
        saveStat(tierOnePromotion, PREVIOUS_MONDAY, 50_400);
        saveStat(tierTwoPromotion, PREVIOUS_MONDAY, 100_800);
        saveStat(relegationEquality, PREVIOUS_MONDAY, 100_800);
        saveStat(belowRelegation, PREVIOUS_MONDAY, 100_799);
        saveStat(tierFive, PREVIOUS_MONDAY, 999_999);
        flushFixtures();

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        Map<String, LeagueWeeklyResult> results = resultsByNickname();
        assertResult(results.get("tierOnePromotion"), LeagueWeeklyResultType.PROMOTED, 1, 2, 50_400);
        assertResult(results.get("tierOneZero"), LeagueWeeklyResultType.STAY, 1, 1, 0);
        assertResult(results.get("tierTwoPromotion"), LeagueWeeklyResultType.PROMOTED, 2, 3, 100_800);
        assertResult(results.get("relegationEquality"), LeagueWeeklyResultType.STAY, 3, 3, 100_800);
        assertResult(results.get("belowRelegation"), LeagueWeeklyResultType.RELEGATED, 3, 2, 100_799);
        assertResult(results.get("tierFive"), LeagueWeeklyResultType.STAY, 5, 5, 999_999);
        assertResult(results.get("tierTwoZero"), LeagueWeeklyResultType.RELEGATED, 2, 1, 0);
        assertThat(tierOnePromotion.getTierLevel()).isEqualTo(2);
        assertThat(tierFive.getTierLevel()).isEqualTo(5);
        assertThat(summary.settledMemberCount()).isEqualTo(7);
    }

    @Test
    @DisplayName("직전 KST 월요일~일요일만 합산하고 결과 키는 직전 주 월요일 Instant다")
    void previousKstWeekIsInclusiveAndStoredAsResultKey() {
        User user = saveUser("weeklyWindow", 3, false);
        saveStat(user, PREVIOUS_MONDAY.minusDays(1), 1_000_000);
        saveStat(user, PREVIOUS_MONDAY, 40_000);
        saveStat(user, PREVIOUS_SUNDAY, 70_000);
        saveStat(user, PREVIOUS_SUNDAY.plusDays(1), 1_000_000);
        flushFixtures();

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        LeagueWeeklyResult result = leagueWeeklyResultRepository.findAll().get(0);
        assertThat(result.getWeekStartAt()).isEqualTo(PREVIOUS_WEEK_START);
        assertResult(result, LeagueWeeklyResultType.STAY, 3, 3, 110_000);
    }

    @Test
    @DisplayName("이전 ACTIVE anchor를 모두 마감하고 현재 주 글로벌 anchor 한 행을 만든다")
    void endsPreviousActiveAnchorsAndCreatesOneGlobalAnchor() {
        LeagueArena first = saveAnchor(Instant.parse("2026-06-28T15:00:00Z"), LeagueArenaStatus.ACTIVE);
        LeagueArena second = saveAnchor(Instant.parse("2026-07-05T15:00:00Z"), LeagueArenaStatus.ACTIVE);

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(first.getStatus()).isEqualTo(LeagueArenaStatus.ENDED);
        assertThat(first.getEndedAt()).isEqualTo(BATCH_NOW);
        assertThat(second.getStatus()).isEqualTo(LeagueArenaStatus.ENDED);
        assertThat(second.getEndedAt()).isEqualTo(BATCH_NOW);
        List<LeagueArena> active = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE);
        assertThat(active).singleElement().satisfies(anchor -> {
            assertThat(anchor.getStartedAt()).isEqualTo(BATCH_NOW);
            assertThat(anchor.getEndedAt()).isNull();
        });
        assertThat(summary.endedArenaCount()).isEqualTo(2);
        assertThat(summary.createdArenaCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("최초 실행에 활성 유저가 없어도 현재 주 anchor를 만들고 settled=0을 반환한다")
    void emptyUserDatabaseStillCreatesAnchor() {
        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(summary.settledMemberCount()).isZero();
        assertThat(summary.createdArenaCount()).isEqualTo(1);
        assertThat(leagueWeeklyResultRepository.count()).isZero();
        assertThat(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE))
                .singleElement()
                .extracting(LeagueArena::getStartedAt)
                .isEqualTo(BATCH_NOW);
    }

    @Test
    @DisplayName("현재 주 startedAt anchor가 있으면 결과와 anchor를 중복 생성하지 않는다")
    void rerunThrowsBatchAlreadyRunWithoutDuplicates() {
        User user = saveUser("rerun", 2, false);
        flushFixtures();
        leagueBatchService.runWeeklyBatch(BATCH_NOW);
        long resultCount = leagueWeeklyResultRepository.count();
        long arenaCount = leagueArenaRepository.count();

        assertThatThrownBy(() -> leagueBatchService.runWeeklyBatch(BATCH_NOW))
                .isInstanceOf(LeagueException.class)
                .extracting(exception -> ((LeagueException) exception).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_ALREADY_RUN);
        assertThat(leagueWeeklyResultRepository.count()).isEqualTo(resultCount);
        assertThat(leagueArenaRepository.count()).isEqualTo(arenaCount);
        assertThat(user.getTierLevel()).isEqualTo(1);
    }

    @Test
    @DisplayName("티어 설정이 1~5 중 하나라도 누락되면 정산 전에 TIER_CONFIG_NOT_FOUND")
    void missingTierConfigFailsBeforeAnySettlementWrite() {
        User user = saveUser("missingConfig", 2, false);
        flushFixtures();
        leagueTierConfigRepository.deleteById(4);
        leagueTierConfigRepository.flush();

        assertThatThrownBy(() -> leagueBatchService.runWeeklyBatch(BATCH_NOW))
                .isInstanceOf(LeagueException.class)
                .extracting(exception -> ((LeagueException) exception).getErrorCode())
                .isEqualTo(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
        assertThat(leagueWeeklyResultRepository.count()).isZero();
        assertThat(leagueArenaRepository.count()).isZero();
        assertThat(user.getTierLevel()).isEqualTo(2);
    }

    @Test
    @DisplayName("UUID 커서 페이지 경계에서도 활성 유저를 정확히 한 번 정산하고 삭제 유저를 제외한다")
    void cursorPaginationSettlesEveryActiveUserExactlyOnce() {
        int activeUserCount = LeagueBatchService.SETTLEMENT_PAGE_SIZE + 1;
        List<User> activeUsers = IntStream.range(0, activeUserCount)
                .mapToObj(index -> saveUser("paged" + index, 3, false))
                .toList();
        User deleted = saveUser("pagedDeleted", 3, true);
        saveStat(deleted, PREVIOUS_MONDAY, 999_999);
        flushFixtures();

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        List<LeagueWeeklyResult> results = leagueWeeklyResultRepository.findAll();
        Set<UUID> resultUserIds = results.stream()
                .map(result -> result.getUser().getId())
                .collect(Collectors.toSet());
        assertThat(summary.settledMemberCount()).isEqualTo(activeUserCount);
        assertThat(results).hasSize(activeUserCount)
                .allSatisfy(result -> assertResult(result, LeagueWeeklyResultType.RELEGATED, 3, 2, 0));
        assertThat(resultUserIds).hasSize(activeUserCount)
                .containsExactlyInAnyOrderElementsOf(activeUsers.stream().map(User::getId).toList());
        assertThat(resultUserIds).doesNotContain(deleted.getId());
        // 삭제 유저는 집계 자체에서 빠지므로 skip/failed 어느 버킷에도 잡히지 않는다.
        assertThat(summary.skippedMemberCount()).isZero();
        assertThat(summary.failedMemberCount()).isZero();
    }

    @Test
    @DisplayName("완주한 주차의 resume — 전원 alreadySettled 로 건너뛰고 티어 래칫·보너스 재지급이 없다")
    void resumeAfterCompletedRunIsIdempotent() {
        User promoted = saveUser("resumeIdempotent", 1, false);
        saveStat(promoted, RESUME_PREVIOUS_MONDAY, 50_400);
        flushFixtures();
        leagueBatchService.runWeeklyBatch(RESUME_NOW);
        assertThat(promoted.getTierLevel()).isEqualTo(2);

        LeagueBatchSummaryResponse resumed =
                leagueBatchService.resumeWeeklyBatch(RESUME_NOW, null, null);

        // 가드가 없으면 라이브 tier(2)로 판정을 다시 굴려 연쇄 승급이 나거나 유니크 위반으로 failed 가 된다.
        assertThat(resumed.settledMemberCount()).isZero();
        assertThat(resumed.alreadySettledMemberCount()).isEqualTo(1);
        assertThat(resumed.failedMemberCount()).isZero();
        assertThat(resumed.endedArenaCount()).isZero();
        assertThat(resumed.createdArenaCount()).isZero();
        assertThat(userRepository.findById(promoted.getId()).orElseThrow().getTierLevel()).isEqualTo(2);
        assertThat(leagueWeeklyResultRepository.count()).isEqualTo(1);
        assertThat(bonusCountOf(promoted)).isEqualTo(1);
    }

    @Test
    @DisplayName("가드 anchor 가 없는 주차의 resume 은 BATCH_NOT_RUN — 회전도, 어떤 기록도 하지 않는다")
    void resumeWithoutGuardAnchorIsRejected() {
        User user = saveUser("resumeNoAnchor", 1, false);
        saveStat(user, RESUME_PREVIOUS_MONDAY, 50_400);
        flushFixtures();

        // 전체 재개·표적 재개 모두 같은 전제 가드를 지나야 한다 — 표적 재개가 anchor 를 만들고
        // 지정 유저만 정산하면 이후 스케줄 run 이 409 에 막혀 나머지 전원이 영구 미정산된다(P1).
        assertThatThrownBy(() -> leagueBatchService.resumeWeeklyBatch(RESUME_NOW, null, null))
                .isInstanceOf(LeagueException.class)
                .extracting(exception -> ((LeagueException) exception).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_NOT_RUN);
        assertThatThrownBy(() -> leagueBatchService.resumeWeeklyBatch(
                        RESUME_NOW, null, List.of(user.getId())))
                .isInstanceOf(LeagueException.class)
                .extracting(exception -> ((LeagueException) exception).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_NOT_RUN);
        assertThat(leagueArenaRepository.count()).isZero();
        assertThat(leagueWeeklyResultRepository.count()).isZero();
        assertThat(user.getTierLevel()).isEqualTo(1);
    }

    @Test
    @DisplayName("weekStartAt 이 KST 월요일 00:00 경계가 아니면 INVALID_WEEK_START")
    void resumeRejectsNonMondayWeekStart() {
        assertThatThrownBy(() -> leagueBatchService.resumeWeeklyBatch(
                        RESUME_NOW, RESUME_PREVIOUS_WEEK_START.plusSeconds(3_600), null))
                .isInstanceOf(LeagueException.class)
                .extracting(exception -> ((LeagueException) exception).getErrorCode())
                .isEqualTo(LeagueErrorCode.INVALID_WEEK_START);
    }

    @Test
    @DisplayName("userIds 표적 resume — 지정 유저만 정산하고 나머지는 건드리지 않는다")
    void resumeWithUserIdsSettlesOnlyTargets() {
        User target = saveUser("resumeTarget", 1, false);
        User untouched = saveUser("resumeUntouched", 1, false);
        saveStat(target, RESUME_PREVIOUS_MONDAY, 50_400);
        saveStat(untouched, RESUME_PREVIOUS_MONDAY, 50_400);
        flushFixtures();
        // rotate 직후 크래시로 정산이 전혀 안 된 상황 재현 — 가드 anchor 만 선커밋돼 있다.
        saveAnchor(RESUME_NOW, LeagueArenaStatus.ACTIVE);

        LeagueBatchSummaryResponse first =
                leagueBatchService.resumeWeeklyBatch(RESUME_NOW, null, List.of(target.getId()));

        assertThat(first.settledMemberCount()).isEqualTo(1);
        assertThat(first.alreadySettledMemberCount()).isZero();
        assertThat(first.endedArenaCount()).isZero();
        assertThat(first.createdArenaCount()).isZero();
        assertThat(leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(target.getId()))
                .isPresent();
        assertThat(leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(untouched.getId()))
                .isEmpty();
        assertThat(untouched.getTierLevel()).isEqualTo(1);

        // 같은 표적으로 한 번 더 — 완료 마커가 있으니 alreadySettled 로만 집계된다.
        LeagueBatchSummaryResponse second =
                leagueBatchService.resumeWeeklyBatch(RESUME_NOW, null, List.of(target.getId()));
        assertThat(second.settledMemberCount()).isZero();
        assertThat(second.alreadySettledMemberCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("다음 주차 회전 후에도 weekStartAt 지정 resume 이 그 과거 주차를 정확히 정산한다")
    void resumeExplicitPastWeekSettlesThatWeek() {
        User user = saveUser("resumePastWeek", 1, false);
        saveStat(user, RESUME_PREVIOUS_MONDAY, 50_400);
        flushFixtures();
        // 대상 주차의 가드 anchor + 그 다음 주차 anchor — 한 주가 더 회전해 버린 뒤의 복구 상황.
        saveAnchor(RESUME_NOW, LeagueArenaStatus.ACTIVE);
        Instant weekLater = Instant.parse("2033-07-17T15:00:00Z");
        saveAnchor(weekLater, LeagueArenaStatus.ACTIVE);

        // now 기준 직전 주차는 이미 다른 주(2033-07-11주) — 명시 weekStartAt 이 없으면 엉뚱한
        // 주차를 재개하게 되는 시점(P2-2)에서, 명시 파라미터로 원래 주차를 복구한다.
        LeagueBatchSummaryResponse summary = leagueBatchService.resumeWeeklyBatch(
                weekLater, RESUME_PREVIOUS_WEEK_START, List.of(user.getId()));

        assertThat(summary.settledMemberCount()).isEqualTo(1);
        LeagueWeeklyResult result = leagueWeeklyResultRepository
                .findTopByUserIdOrderByCreatedAtDesc(user.getId()).orElseThrow();
        assertThat(result.getWeekStartAt()).isEqualTo(RESUME_PREVIOUS_WEEK_START);
        assertResult(result, LeagueWeeklyResultType.PROMOTED, 1, 2, 50_400);
        assertThat(user.getTierLevel()).isEqualTo(2);
    }

    @Test
    @DisplayName("주차 종료 후 가입한 유저는 resume 대상에서 제외된다 — 존재하지 않던 주의 0초 결과 조작 방지")
    void resumeExcludesUsersCreatedAfterSettledWeek() {
        // 먼 과거 주차를 재개 — 픽스처 유저의 created_at(지금)은 주차 종료 경계(2020-07-12) 이후라
        // 전원 "그 주에 존재하지 않았던 가입자"다.
        User lateSignup = saveUser("resumeLateSignup", 1, false);
        saveStat(lateSignup, PAST_MONDAY, 50_400);
        flushFixtures();
        saveAnchor(PAST_WEEK_BOUNDARY, LeagueArenaStatus.ACTIVE);

        LeagueBatchSummaryResponse fullResume =
                leagueBatchService.resumeWeeklyBatch(RESUME_NOW, PAST_WEEK_START, null);
        LeagueBatchSummaryResponse targetedResume = leagueBatchService.resumeWeeklyBatch(
                RESUME_NOW, PAST_WEEK_START, List.of(lateSignup.getId()));

        // 전체 순회·표적 조회 두 경로 모두 컷오프가 걸린다 — 결과 행도 티어 변화도 없어야 한다.
        assertThat(fullResume.settledMemberCount()).isZero();
        assertThat(fullResume.alreadySettledMemberCount()).isZero();
        assertThat(fullResume.failedMemberCount()).isZero();
        assertThat(targetedResume.settledMemberCount()).isZero();
        assertThat(leagueWeeklyResultRepository.count()).isZero();
        assertThat(lateSignup.getTierLevel()).isEqualTo(1);
    }

    @Test
    @DisplayName("늦은 주차가 이미 정산된 유저는 과거 주차 소급을 건너뛰고, 아닌 유저만 정산한다")
    void resumeSkipsSupersededUserButSettlesOthers() {
        // advanced: W+1(2033-07-10T15:00Z 키) 결과가 이미 있는 유저 — 티어 체인이 전진했다.
        // 소급하면 라이브 tier(2)를 W 의 "이전 티어"로 삼아 승급을 겹쳐 굴리게 된다(라운드3 P1).
        User advanced = saveUser("resumeSuperseded", 2, false);
        // pending: W 정산에 실패했고 W+1 도 정산한 적 없는 유저 — 실제 복구 대상.
        User pending = saveUser("resumePending", 1, false);
        saveStat(advanced, RESUME_PREVIOUS_MONDAY, 50_400);
        saveStat(pending, RESUME_PREVIOUS_MONDAY, 50_400);
        flushFixtures();
        leagueWeeklyResultRepository.save(LeagueWeeklyResult.builder()
                .user(advanced)
                .weekStartAt(RESUME_NOW)
                .previousTierLevel(1)
                .newTierLevel(2)
                .result(LeagueWeeklyResultType.PROMOTED)
                .focusSeconds(60_000)
                .build());
        leagueWeeklyResultRepository.flush();
        saveAnchor(RESUME_NOW, LeagueArenaStatus.ACTIVE);

        // settler 단독 호출로 신규 outcome 을 못박는다 — 요약에서는 already 로 접히기 때문.
        Map<Integer, LeagueTierConfig> tierConfigs = leagueTierConfigRepository.findAll().stream()
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
        assertThat(leagueUserSettler.settle(
                new LeagueRankingRow(advanced.getId(), "resumeSuperseded", 2, 50_400),
                RESUME_PREVIOUS_WEEK_START, tierConfigs))
                .isEqualTo(LeagueUserSettler.SettleOutcome.SKIPPED_SUPERSEDED);

        LeagueBatchSummaryResponse summary = leagueBatchService.resumeWeeklyBatch(
                RESUME_NOW, RESUME_PREVIOUS_WEEK_START,
                List.of(advanced.getId(), pending.getId()));

        assertThat(summary.settledMemberCount()).isEqualTo(1);
        assertThat(summary.alreadySettledMemberCount()).isEqualTo(1);
        assertThat(summary.failedMemberCount()).isZero();
        // advanced 불변 — W 결과 행 없음·티어 2 유지·보너스 신규 지급 없음(체인 오염 차단).
        assertThat(leagueWeeklyResultRepository.findUserIdsByWeekStartAtAndUserIdIn(
                RESUME_PREVIOUS_WEEK_START, List.of(advanced.getId()))).isEmpty();
        assertThat(advanced.getTierLevel()).isEqualTo(2);
        assertThat(bonusCountOf(advanced)).isZero();
        // pending 은 W 키로 정산 완료 — 늦은 주차 결과가 없는 유저만이 소급 복구 대상이다.
        LeagueWeeklyResult pendingResult = leagueWeeklyResultRepository
                .findTopByUserIdOrderByCreatedAtDesc(pending.getId()).orElseThrow();
        assertThat(pendingResult.getWeekStartAt()).isEqualTo(RESUME_PREVIOUS_WEEK_START);
        assertThat(pending.getTierLevel()).isEqualTo(2);
    }

    @Test
    @DisplayName("판정 티어는 락으로 잡은 유저 행이 정본 — 낡은 스냅샷 tierLevel 은 무시된다")
    void settleUsesLockedTierNotSnapshotTier() {
        User user = saveUser("lockedTierAuthority", 2, false);
        flushFixtures();
        Map<Integer, LeagueTierConfig> tierConfigs = leagueTierConfigRepository.findAll().stream()
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
        // 교차 주차 레이스의 결정적 재현(라운드4 P1) — 페이지 스냅샷은 tier 1 로 낡았지만,
        // 그 사이 다른 주차 정산이 커밋한(즉 락으로 다시 읽으면 보이는) 티어는 2 다.
        LeagueRankingRow staleRow =
                new LeagueRankingRow(user.getId(), "lockedTierAuthority", 1, 100_800);

        assertThat(leagueUserSettler.settle(staleRow, PREVIOUS_WEEK_START, tierConfigs))
                .isEqualTo(LeagueUserSettler.SettleOutcome.SETTLED);

        // 스냅샷(tier 1) 기준이면 (1→2)로 남았을 것 — 락 정본(tier 2) 기준 (2→3) 승급이어야 한다.
        LeagueWeeklyResult result = leagueWeeklyResultRepository
                .findTopByUserIdOrderByCreatedAtDesc(user.getId()).orElseThrow();
        assertResult(result, LeagueWeeklyResultType.PROMOTED, 2, 3, 100_800);
        assertThat(user.getTierLevel()).isEqualTo(3);
    }

    @Test
    @DisplayName("settler 2회 호출 — 2회차는 ALREADY_SETTLED 를 반환하고 아무 mutation 도 없다")
    void settlerSecondCallReturnsAlreadySettledWithoutMutation() {
        User user = saveUser("settleTwice", 1, false);
        saveStat(user, PREVIOUS_MONDAY, 50_400);
        flushFixtures();
        Map<Integer, LeagueTierConfig> tierConfigs = leagueTierConfigRepository.findAll().stream()
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
        LeagueRankingRow row = new LeagueRankingRow(user.getId(), user.getNickname(), 1, 50_400);

        assertThat(leagueUserSettler.settle(row, PREVIOUS_WEEK_START, tierConfigs))
                .isEqualTo(LeagueUserSettler.SettleOutcome.SETTLED);
        leagueWeeklyResultRepository.flush();

        // 2회차 — 가드가 없으면 락으로 읽은 라이브 tier(2)로 다시 굴려 2→3 연쇄 승급이 나는 경로다.
        LeagueRankingRow rerunRow = new LeagueRankingRow(user.getId(), user.getNickname(), 2, 50_400);
        assertThat(leagueUserSettler.settle(rerunRow, PREVIOUS_WEEK_START, tierConfigs))
                .isEqualTo(LeagueUserSettler.SettleOutcome.ALREADY_SETTLED);

        assertThat(userRepository.findById(user.getId()).orElseThrow().getTierLevel()).isEqualTo(2);
        assertThat(leagueWeeklyResultRepository.count()).isEqualTo(1);
        assertThat(bonusCountOf(user)).isEqualTo(1);
    }

    private long bonusCountOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(transaction -> transaction.getType() == CurrencyTransactionType.LEAGUE_TIER_BONUS)
                .count();
    }

    private User saveUser(String nickname, int tierLevel, boolean deleted) {
        User user = userRepository.save(User.builder()
                .nickname(nickname)
                .tierLevel(tierLevel)
                .isDeleted(deleted)
                .build());
        // 승급 보너스 지급(credit)은 지갑을 전제로 하므로 프로덕션처럼 유저별 지갑을 함께 만든다.
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).build());
        return user;
    }

    private void saveStat(User user, LocalDate date, int seconds) {
        dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user)
                .date(date)
                .totalFocusSeconds(seconds)
                .build());
    }

    private LeagueArena saveAnchor(Instant startedAt, LeagueArenaStatus status) {
        return leagueArenaRepository.save(LeagueArena.builder()
                .startedAt(startedAt)
                .status(status)
                .build());
    }

    private void flushFixtures() {
        userRepository.flush();
        dailyFocusStatRepository.flush();
    }

    private Map<String, LeagueWeeklyResult> resultsByNickname() {
        return leagueWeeklyResultRepository.findAll().stream()
                .collect(Collectors.toMap(result -> result.getUser().getNickname(), Function.identity()));
    }

    private void assertResult(
            LeagueWeeklyResult actual,
            LeagueWeeklyResultType result,
            int previousTier,
            int newTier,
            int focusSeconds) {
        assertThat(actual.getResult()).isEqualTo(result);
        assertThat(actual.getPreviousTierLevel()).isEqualTo(previousTier);
        assertThat(actual.getNewTierLevel()).isEqualTo(newTier);
        assertThat(actual.getFocusSeconds()).isEqualTo(focusSeconds);
    }
}

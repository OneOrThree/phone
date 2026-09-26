package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.repository.IslandConstructionContributionRepository;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.domain.FacilityStatus;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.repository.domain.IslandFacilityId;
import com.oneorthree.phone.construction.scheduler.IslandConstructionScheduler;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.construction.dto.ConstructionStartedView;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 건설 POST 전체 트랜잭션의 최소 통합 검증 (GROMO-1767).
 *
 * <p>이 클래스가 <b>동시에 V62 실 마이그레이션 검증</b>이다 — 배선이
 * {@code OutboxTestPostgres.applyProductionMigrationWiring} 이라 컨텍스트 부팅 때 V1 부터
 * V62 까지 운영 Flyway 를 전부 돌리고 {@code ddl-auto=validate} 가 엔티티 ↔ 스키마 드리프트를
 * 맞댄다. 비용 정책 revision 1 은 V62 가 심은 그대로 쓴다.
 */
@SpringBootTest
class IslandConstructionIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    IslandConstructionService service;
    @Autowired
    IslandConstructionScheduler scheduler;
    @Autowired
    IslandWalletService walletService;
    @Autowired
    IslandWalletRepository wallets;
    @Autowired
    IslandConstructionStateRepository states;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    IslandConstructionContributionRepository contributions;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("건설 시작은 총액을 한 번 차감하고 BUILDING·시각·목표 해제를 확정한다 — 같은 키 재생은 추가 차감이 없다")
    void startDebitsOnceAndReplayAddsNothing() {
        Fixture f = fundedIsland(100, "hall");
        UUID key = UUID.randomUUID();
        assertThat(service.options(f.islandId, f.ownerId).activeConstruction()).isNull();

        ConstructionStartedView first = service.start(
                f.islandId, f.ownerId, "hall", 0, 1, key);

        // BUILDING 접수 — 즉시 완공 계약은 폐기됐다. completesAt = startedAt + 60초(회관).
        assertThat(first.status()).isEqualTo("BUILDING");
        assertThat(first.buildingId()).isEqualTo("hall");
        assertThat(first.spent().currency()).isEqualTo("village_points");
        assertThat(first.spent().amount()).isEqualTo(60);
        assertThat(first.startedAt()).isNotNull();
        assertThat(first.completesAt()).isEqualTo(first.startedAt().plusSeconds(60));
        assertThat(first.villagePoints()).isEqualTo(40);

        var options = service.options(f.islandId, f.ownerId);
        assertThat(options.activeConstruction()).isNotNull();
        assertThat(options.activeConstruction().buildingId()).isEqualTo("hall");
        assertThat(options.activeConstruction().status()).isEqualTo("BUILDING");
        assertThat(options.activeConstruction().startedAt()).isEqualTo(toDbMicros(first.startedAt()));
        assertThat(options.activeConstruction().completesAt()).isEqualTo(toDbMicros(first.completesAt()));
        assertThat(options.activeConstruction().serverNow()).isNotNull();
        assertThat(options.activeConstruction().version()).isEqualTo(options.islandVersion());

        // 단일 TX 의 세 확정 — 차감 1회, 시설 BUILDING, 목표 해제.
        IslandFacility facility = facilities
                .findById(new IslandFacilityId(f.islandId, "hall")).orElseThrow();
        assertThat(facility.getStatus()).isEqualTo(FacilityStatus.BUILDING);
        // PostgreSQL timestamp 는 마이크로초 정밀도로 반올림해 저장한다 — 응답의 나노초 시각은
        // 왕복 후 반올림되므로 기대쪽을 같은 변환으로 맞춰 비교한다(허용오차가 아니라 정밀도 정규화).
        assertThat(facility.getStartedAt()).isEqualTo(toDbMicros(first.startedAt()));
        assertThat(facility.getCompletesAt()).isEqualTo(toDbMicros(first.completesAt()));
        assertThat(facility.getCompletedAt()).isNull();
        assertThat(states.findById(f.islandId).orElseThrow().getTargetBuildingId()).isNull();
        assertThat(balance(f.islandId)).isEqualTo(40);
        assertThat(debitCount(f.islandId)).isEqualTo(1);

        // 같은 Idempotency-Key 재생 — receipt 를 돌려주고 새 차감·새 시설·새 사건이 없다.
        ConstructionStartedView second = service.start(
                f.islandId, f.ownerId, "hall", 0, 1, key);

        assertThat(second.status()).isEqualTo("BUILDING");
        assertThat(second.completesAt()).isEqualTo(first.completesAt());
        assertThat(second.villagePoints()).isEqualTo(40);
        assertThat(balance(f.islandId)).isEqualTo(40);
        assertThat(debitCount(f.islandId)).isEqualTo(1);
        assertThat(count("island_facilities", f.islandId)).isEqualTo(1);
    }

    @Test
    @DisplayName("완공 스윕은 기한이 지난 BUILDING 행만 COMPLETED 로 전이한다")
    void sweepCompletesOnlyDueBuildings() {
        Fixture f = fundedIsland(100, "hall");
        service.start(f.islandId, f.ownerId, "hall", 0, 1, UUID.randomUUID());

        // 아직 기한 전 — 스윕이 건드리지 않는다.
        scheduler.completeDueFacilities();
        assertThat(facilities.findById(new IslandFacilityId(f.islandId, "hall")).orElseThrow()
                .getStatus()).isEqualTo(FacilityStatus.BUILDING);

        // 기한을 과거로 당기면 다음 스윕이 전이한다.
        jdbc.update("UPDATE island_facilities SET completes_at = ? WHERE island_id = ?",
                Timestamp.from(Instant.now().minus(1, ChronoUnit.MINUTES)), f.islandId);
        scheduler.completeDueFacilities();

        IslandFacility done = facilities
                .findById(new IslandFacilityId(f.islandId, "hall")).orElseThrow();
        assertThat(done.getStatus()).isEqualTo(FacilityStatus.COMPLETED);
        assertThat(done.getCompletedAt()).isNotNull();
    }

    // ---------------------------------------------------------------- 잠금 순서 · 스냅샷

    @Test
    @DisplayName("contribute 는 건설 상태 → 지갑 순으로 잠근다 — 건설 명령과 같은 순서라 데드락 쌍이 없다")
    void contributeLocksStateBeforeWallet() throws IOException {
        // 구조 검증 — 교착 재현은 플래키하므로, contribute 본문의 잠금 호출 순서를 소스에서 잠근다.
        // 지갑을 먼저 잡는 편집은 여기서 실패한다.
        String source = Files.readString(Path.of(
                "src/main/java/com/oneorthree/phone/construction/service/IslandWalletService.java"));
        int from = source.indexOf("public void contribute(");
        assertThat(from).as("contribute 메서드를 찾아야 한다").isPositive();
        String body = source.substring(from, source.indexOf("\n    }", from));

        int stateInsert = body.indexOf("states.insertIfAbsent");
        int stateLock = body.indexOf("states.findByIdForUpdate");
        int walletInsert = body.indexOf("wallets.insertIfAbsent");
        int walletLock = body.indexOf("wallets.findByIdForUpdate");
        assertThat(stateInsert).isPositive();
        assertThat(stateLock).as("state 삽입 → state 잠금").isGreaterThan(stateInsert);
        assertThat(walletInsert).as("state 잠금 → wallet 삽입").isGreaterThan(stateLock);
        assertThat(walletLock).as("wallet 삽입 → wallet 잠금").isGreaterThan(walletInsert);
    }

    @Test
    @DisplayName("options 는 REPEATABLE_READ 읽기 트랜잭션이다 — 잔액·시설·버전이 한 스냅샷에서 읽힌다")
    void optionsReadsOneConsistentSnapshot() throws NoSuchMethodException {
        Transactional tx = IslandConstructionService.class
                .getMethod("options", UUID.class, UUID.class)
                .getAnnotation(Transactional.class);
        assertThat(tx).isNotNull();
        assertThat(tx.readOnly()).isTrue();
        assertThat(tx.isolation())
                .as("READ COMMITTED 는 문장마다 스냅샷이 갈려 응답 필드가 다른 시점을 섞는다")
                .isEqualTo(Isolation.REPEATABLE_READ);
    }

    // ---------------------------------------------------------------- 멱등 동시성

    @Test
    @DisplayName("같은 멱등 키의 동시 기여 둘은 한 번만 적힌다 — 둘 다 정상 종료·지갑 1회·기여 1행·원장 1행")
    void concurrentContributeWithSameKeyWritesOnce() throws Exception {
        Fixture f = islandOnly();
        chooseTarget(f.islandId, "hall");
        String key = "k-race-" + f.islandId;

        // 두 TX 가 잠금 전 멱등 판정을 나란히 지나도록 같은 게이트에서 풀어 준다 — 후발이
        // 상태 행 잠금 뒤 재검사에서 선발의 기입을 보는지가 이 회귀의 핵심이다.
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch gate = new CountDownLatch(1);
            Callable<Void> call = () -> {
                gate.await();
                tx().executeWithoutResult(status ->
                        walletService.contribute(f.islandId, f.ownerId, 50, key));
                return null;
            };
            Future<Void> first = pool.submit(call);
            Future<Void> second = pool.submit(call);
            gate.countDown();
            first.get(30, TimeUnit.SECONDS);
            second.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        assertThat(balance(f.islandId)).isEqualTo(50);
        Integer accumulated = jdbc.queryForObject(
                "SELECT amount FROM island_construction_contributions WHERE island_id = ?",
                Integer.class, f.islandId);
        assertThat(accumulated).as("주민별 기여도 한 번만 누적된다").isEqualTo(50);
        assertThat(ledgerCount(f.islandId)).isEqualTo(1);
    }

    @Test
    @DisplayName("다른 type 이 같은 멱등 키를 써도 각 operation 은 독립이다 — 차감·기여 둘 다 정상 기입된다")
    void differentTypeWithSameKeyRunsIndependently() {
        Fixture f = islandOnly();
        String key = "k-shared-" + f.islandId;
        tx().executeWithoutResult(status -> {
            walletService.contribute(f.islandId, f.ownerId, 100, "seed-" + f.islandId);
            walletService.debitForConstruction(f.islandId, 40, key);
        });

        // 멱등 scope 는 (섬, operation=type, 키) — CONSTRUCTION_DEBIT 이 쓴 키를 CONTRIBUTION 이
        // 다시 써도 다른 기입이다.
        tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 10, key));

        assertThat(balance(f.islandId)).isEqualTo(70);
        assertThat(ledgerCount(f.islandId)).isEqualTo(3);
    }

    @Test
    @DisplayName("서로 다른 섬의 같은 멱등 키 동시 기여는 둘 다 적힌다 — 멱등 scope 에 섬이 들어간다")
    void concurrentContributeSameKeyAcrossIslandsWritesBoth() throws Exception {
        Fixture a = islandOnly();
        Fixture b = islandOnly();
        chooseTarget(a.islandId, "hall");
        chooseTarget(b.islandId, "hall");
        String key = "k-two-islands";

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch gate = new CountDownLatch(1);
            Callable<Void> callA = () -> {
                gate.await();
                tx().executeWithoutResult(status ->
                        walletService.contribute(a.islandId, a.ownerId, 50, key));
                return null;
            };
            Callable<Void> callB = () -> {
                gate.await();
                tx().executeWithoutResult(status ->
                        walletService.contribute(b.islandId, b.ownerId, 50, key));
                return null;
            };
            Future<Void> first = pool.submit(callA);
            Future<Void> second = pool.submit(callB);
            gate.countDown();
            first.get(30, TimeUnit.SECONDS);
            second.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        for (Fixture f : new Fixture[] {a, b}) {
            assertThat(balance(f.islandId)).isEqualTo(50);
            Integer accumulated = jdbc.queryForObject(
                    "SELECT amount FROM island_construction_contributions WHERE island_id = ?",
                    Integer.class, f.islandId);
            assertThat(accumulated).isEqualTo(50);
            assertThat(ledgerCount(f.islandId)).isEqualTo(1);
        }
    }

    // ---------------------------------------------------------------- 멱등 재생 권한

    @Test
    @DisplayName("강퇴된 방장의 같은 키 PUT 재생은 403 이다 — 재생 권한은 현재 상태로 다시 검사한다")
    void replayedTargetPutIsForbiddenAfterKick() {
        SharedFixture f = sharedIsland();
        UUID key = UUID.randomUUID();
        service.setTarget(f.islandId, f.ownerId, "hall", 0, key);

        // 강퇴 — 활성 멤버십만 없어지고 계정·섬은 살아 있다.
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ? AND group_id = ?",
                f.ownerId, f.islandId);

        assertThatThrownBy(() -> service.setTarget(f.islandId, f.ownerId, "hall", 0, key))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN);
    }

    @Test
    @DisplayName("방장에서 내려온 뒤의 같은 키 POST 재생은 403 이다 — 건설은 방장만이다")
    void replayedBuildIsForbiddenAfterHostHandover() {
        SharedFixture f = sharedIsland();
        tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 100, "seed-" + f.islandId));
        UUID key = UUID.randomUUID();
        service.start(f.islandId, f.ownerId, "hall", 0, 1, key);

        // 방장을 위임했다 — 전 방장의 건설 권한은 사라지고 재생도 그때의 권한을 되살리지 않는다.
        jdbc.update("UPDATE group_members SET role = 'MEMBER' WHERE user_id = ? AND group_id = ?",
                f.ownerId, f.islandId);

        assertThatThrownBy(() -> service.start(f.islandId, f.ownerId, "hall", 0, 1, key))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN);
        // 재생이 거절됐으니 추가 차감도 없다.
        assertThat(balance(f.islandId)).isEqualTo(40);
        assertThat(debitCount(f.islandId)).isEqualTo(1);
    }

    @Test
    @DisplayName("일반 주민은 목표 선택도 건설하기도 못 한다 — 건설은 방장만(GROMO-2000)")
    void residentsCannotSelectTargetOrBuild() {
        SharedFixture f = sharedIsland();
        tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 100, "seed-" + f.islandId));

        assertThatThrownBy(() -> service.setTarget(f.islandId, f.memberId, "hall", 0,
                UUID.randomUUID()))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN);
        assertThatThrownBy(() -> service.start(f.islandId, f.memberId, "hall", 0, 1,
                UUID.randomUUID()))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN);
        // 조회는 막지 않되 항목마다 FORBIDDEN 사유를 준다(C08).
        assertThat(service.options(f.islandId, f.memberId).items())
                .isNotEmpty()
                .allSatisfy(item -> {
                    assertThat(item.selectable()).isFalse();
                    assertThat(item.blockedReason()).isEqualTo("FORBIDDEN");
                });
    }

    // ---------------------------------------------------------------- 숫자 상한

    @Test
    @DisplayName("잔액이 int 상한을 넘는 기여는 도메인 거절 — 조용한 wrap 없이 잔액·원장이 그대로다")
    void contributeRejectsBalanceOverflow() {
        Fixture f = fundedIsland(100, "hall");
        jdbc.update("UPDATE island_wallets SET balance = ? WHERE island_id = ?",
                Integer.MAX_VALUE - 5, f.islandId);

        assertThatThrownBy(() -> tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 10, "k-overflow")))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.OUT_OF_RANGE);

        assertThat(balance(f.islandId)).isEqualTo(Integer.MAX_VALUE - 5);
        assertThat(contributionCount(f.islandId))
                .as("시드 행만 있고 거절된 기여는 새 행을 남기지 않는다").isEqualTo(1);
        assertThatThrownBy(() -> tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 0, "k-zero")))
                .as("0·음수 기여도 같은 거절이다")
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.OUT_OF_RANGE);
    }

    @Test
    @DisplayName("기여 누적이 int 상한을 넘으면 upsert 가 건너뛰고 도메인 거절 — 지갑 적립도 롤백된다")
    void contributeRejectsAccumulatedOverflow() {
        Fixture f = fundedIsland(100, "hall");
        long epoch = states.findById(f.islandId).orElseThrow().getTargetEpoch();
        jdbc.update("UPDATE island_construction_contributions SET amount = ? "
                        + "WHERE island_id = ? AND epoch = ? AND user_id = ?",
                Integer.MAX_VALUE - 5, f.islandId, epoch, f.ownerId);

        assertThatThrownBy(() -> tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 10, "k-acc-overflow")))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.OUT_OF_RANGE);

        assertThat(balance(f.islandId)).as("지갑 적립도 롤백").isEqualTo(100);
        Integer accumulated = jdbc.queryForObject(
                "SELECT amount FROM island_construction_contributions "
                        + "WHERE island_id = ? AND epoch = ? AND user_id = ?",
                Integer.class, f.islandId, epoch, f.ownerId);
        assertThat(accumulated).isEqualTo(Integer.MAX_VALUE - 5);
    }

    // ---------------------------------------------------------------- 목표 epoch

    @Test
    @DisplayName("목표가 없는 동안의 기여는 지갑·원장만 적립하고 주민별 기여 행은 남기지 않는다")
    void contributeWithoutTargetCreditsWalletOnly() {
        Fixture f = islandOnly();
        tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 30, "k-no-target"));

        assertThat(balance(f.islandId)).isEqualTo(30);
        assertThat(contributionCount(f.islandId))
                .as("무목표 epoch 의 기여는 「각자 몫」집계에 들어가지 않는다(정책 P-D04)")
                .isZero();
    }

    @Test
    @DisplayName("「각자 몫」건물은 지금 목표가 아니면 STATE_CONFLICT — 다른 목표의 epoch 기여를 못 쓴다")
    void residentSplitRejectsWhenTargetDiffers() {
        Fixture f = fundedIsland(3000, "library");
        // gram 의 선행(board 완공)까지 채워 선행 가드가 아니라 목표 가드만 남긴다.
        completeFacility(f, "board");

        assertThatThrownBy(() -> service.start(f.islandId, f.ownerId, "gram", 0, 1,
                UUID.randomUUID()))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.STATE_CONFLICT);

        // 거절됐으니 잔액·시설은 그대로다 — library epoch 의 기여를 gram 에 쓰지 못했다.
        assertThat(balance(f.islandId)).isEqualTo(3000);
        assertThat(count("island_facilities", f.islandId)).isEqualTo(1);
        assertThat(debitCount(f.islandId)).isZero();
    }

    @Test
    @DisplayName("「각자 몫」건물은 목표 epoch 아래 전원 몫을 채우면 BUILDING 을 접수한다")
    void residentSplitStartsWhenTargetMatches() {
        Fixture f = fundedIsland(1360, "gram");
        completeFacility(f, "board");

        ConstructionStartedView view = service.start(f.islandId, f.ownerId, "gram", 0, 1,
                UUID.randomUUID());

        // gram 1360 ÷ 주민 1명 = 1360 — 목표를 고른 뒤의 기여가 몫을 채웠다.
        assertThat(view.status()).isEqualTo("BUILDING");
        assertThat(view.spent().amount()).isEqualTo(1360);
        assertThat(balance(f.islandId)).isZero();
        assertThat(facilities.findById(new IslandFacilityId(f.islandId, "gram")).orElseThrow()
                .getStatus()).isEqualTo(FacilityStatus.BUILDING);
        assertThat(states.findById(f.islandId).orElseThrow().getTargetBuildingId()).isNull();
    }

    @Test
    @DisplayName("다른 건물을 지어도 성공한 POST 는 걸려 있던 목표를 같은 TX 에서 해제한다")
    void startClearsTargetEvenWhenOtherBuildingStarts() {
        Fixture f = fundedIsland(100, "board"); // 목표는 board 인데 hall 을 짓는다
        ConstructionStartedView view = service.start(f.islandId, f.ownerId, "hall", 0, 1,
                UUID.randomUUID());

        assertThat(view.status()).isEqualTo("BUILDING");
        assertThat(states.findById(f.islandId).orElseThrow().getTargetBuildingId()).isNull();
        assertThat(facilities.findById(new IslandFacilityId(f.islandId, "hall")).orElseThrow()
                .getStatus()).isEqualTo(FacilityStatus.BUILDING);
        assertThat(balance(f.islandId)).isEqualTo(40);
        assertThat(debitCount(f.islandId)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 자유 순서 (GROMO-1999)

    @Test
    @DisplayName("게시판 뒤 넷은 순서가 자유다 — 축음기 없이도 도서관을 짓는다")
    void freeOrderLetsLibraryPrecedeGram() {
        Fixture f = fundedIsland(2720, "library");
        completeFacility(f, "hall");
        completeFacility(f, "board");

        ConstructionStartedView view = service.start(f.islandId, f.ownerId, "library", 0, 1,
                UUID.randomUUID());

        assertThat(view.status()).isEqualTo("BUILDING");
        assertThat(view.spent().amount()).isEqualTo(2720);
    }

    @Test
    @DisplayName("상점은 나머지 넷이 모두 완공돼야 고를 수 있다 — 하나라도 빠지면 FACILITY_LOCKED")
    void shopNeedsEveryOtherBuilding() {
        Fixture f = islandOnly();
        completeFacility(f, "hall");
        completeFacility(f, "board");
        completeFacility(f, "gram");
        completeFacility(f, "library");
        completeFacility(f, "mail");

        // 전망대만 빠진 상태 — 상점 목표 선택은 막힌다.
        assertThatThrownBy(() -> service.setTarget(f.islandId, f.ownerId, "shop", 0,
                UUID.randomUUID()))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.FACILITY_LOCKED);

        completeFacility(f, "tower");
        assertThat(service.setTarget(f.islandId, f.ownerId, "shop", 0, UUID.randomUUID())
                .buildingId()).isEqualTo("shop");
    }

    @Test
    @DisplayName("한 번에 한 건물만 진행한다 — 공사 중이면 다른 건물 착공도 목표 변경도 막힌다")
    void onlyOneBuildingRunsAtATime() {
        Fixture f = fundedIsland(100, "hall");
        service.start(f.islandId, f.ownerId, "hall", 0, 1, UUID.randomUUID());
        long version = service.options(f.islandId, f.ownerId).islandVersion();

        assertThatThrownBy(() -> service.start(f.islandId, f.ownerId, "board", version, 1,
                UUID.randomUUID()))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.STATE_CONFLICT);
        assertThatThrownBy(() -> service.setTarget(f.islandId, f.ownerId, "board", version,
                UUID.randomUUID()))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.STATE_CONFLICT);
        assertThat(count("island_facilities", f.islandId)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 목표 선택 당시 대상 주민

    @Test
    @DisplayName("대상은 목표 선택 당시의 주민으로 고정된다 — 뒤에 가입한 주민은 몫을 지지 않는다")
    void targetCohortIsPinnedAtSelection() {
        SharedFixture f = sharedIsland();
        completeFacility(new Fixture(f.islandId, f.ownerId), "hall");
        completeFacility(new Fixture(f.islandId, f.ownerId), "board");
        service.setTarget(f.islandId, f.ownerId, "gram", 0, UUID.randomUUID());

        // 목표를 고른 «뒤» 새 주민이 들어온다 — 대상이 아니므로 분모도 몫도 바뀌지 않는다.
        UUID latecomer = joinNewMember(f.islandId);

        // 대상 2명 → 각자 ceil(1360/2)=680.
        tx().executeWithoutResult(status -> {
            walletService.contribute(f.islandId, f.ownerId, 680, "own-" + f.islandId);
            walletService.contribute(f.islandId, f.memberId, 680, "mem-" + f.islandId);
        });

        Integer latecomerRow = jdbc.queryForObject(
                "SELECT COUNT(*) FROM island_construction_contributions "
                        + "WHERE island_id = ? AND user_id = ?",
                Integer.class, f.islandId, latecomer);
        assertThat(latecomerRow).as("대상 밖 주민은 기여 행 자체가 없다").isZero();

        long version = service.options(f.islandId, f.ownerId).islandVersion();
        assertThat(service.start(f.islandId, f.ownerId, "gram", version, 1, UUID.randomUUID())
                .status()).isEqualTo("BUILDING");
    }

    @Test
    @DisplayName("탈퇴·강퇴한 주민은 대상에서 빠진다 — 남은 대상 인원으로 몫을 다시 나눈다")
    void leavingResidentDropsOutOfTheTarget() {
        SharedFixture f = sharedIsland();
        completeFacility(new Fixture(f.islandId, f.ownerId), "hall");
        completeFacility(new Fixture(f.islandId, f.ownerId), "board");
        service.setTarget(f.islandId, f.ownerId, "gram", 0, UUID.randomUUID());
        tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 1360, "own-" + f.islandId));
        long version = service.options(f.islandId, f.ownerId).islandVersion();

        // 대상 2명이면 각자 680 이 필요한데 주민은 0 이다 — 잔액이 총액을 넘어도 몫이 비었다.
        assertThatThrownBy(() -> service.start(f.islandId, f.ownerId, "gram", version, 1,
                UUID.randomUUID()))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.INSUFFICIENT_FUNDS);

        // 그 주민이 강퇴되면 대상은 방장 1명 — 몫은 1360 이고 방장이 이미 채웠다.
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ? AND group_id = ?",
                f.memberId, f.islandId);
        assertThat(service.start(f.islandId, f.ownerId, "gram", version, 1, UUID.randomUUID())
                .status()).isEqualTo("BUILDING");
    }

    @Test
    @DisplayName("목표 선택 뒤 탈퇴→재가입한 주민은 옛 epoch 대상에서 빠진다 — 옛 기여도 인정되지 않는다")
    void rejoinedResidentDoesNotReviveOldEpoch() {
        SharedFixture f = sharedIsland();
        completeFacility(new Fixture(f.islandId, f.ownerId), "hall");
        completeFacility(new Fixture(f.islandId, f.ownerId), "board");
        service.setTarget(f.islandId, f.ownerId, "gram", 0, UUID.randomUUID());
        // 대상 2명 — 각자 ceil(1360/2)=680. 탈퇴 전 주민 몫까지 채워 둔다.
        tx().executeWithoutResult(status -> {
            walletService.contribute(f.islandId, f.ownerId, 680, "own-" + f.islandId);
            walletService.contribute(f.islandId, f.memberId, 680, "mem-" + f.islandId);
        });

        // 선택 뒤 탈퇴 → 같은 행을 되살려 재가입 — 옛 기여 행은 지워지지 않고 남는다.
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ? AND group_id = ?",
                f.memberId, f.islandId);
        jdbc.update("UPDATE group_members SET is_left = false, left_reason = NULL, left_at = NULL,"
                + " rejoined_at = now() WHERE user_id = ? AND group_id = ?",
                f.memberId, f.islandId);

        // 재가입 주민은 여전히 활성 주민인데도 대상이 아니다 — 분모는 방장 1명이고 몫은 1360.
        assertThat(members.existsByGroupIdAndUserId(f.islandId, f.memberId)).isTrue();
        long version = service.options(f.islandId, f.ownerId).islandVersion();
        assertThatThrownBy(() -> service.start(f.islandId, f.ownerId, "gram", version, 1,
                UUID.randomUUID()))
                .as("재가입 주민의 옛 기여 680 이 인정됐다면 두 명 몫으로 이미 지어졌다")
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.INSUFFICIENT_FUNDS);
    }

    @Test
    @DisplayName("목표를 실제로 바꾸면 새 epoch 대상에 재가입 주민이 다시 포함된다")
    void retargetSeedsRejoinedResidentIntoNewCohort() {
        SharedFixture f = sharedIsland();
        completeFacility(new Fixture(f.islandId, f.ownerId), "hall");
        completeFacility(new Fixture(f.islandId, f.ownerId), "board");
        service.setTarget(f.islandId, f.ownerId, "gram", 0, UUID.randomUUID());

        // 선택 뒤 탈퇴→재가입 — 옛 epoch 에서는 빠진 사람이다.
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ? AND group_id = ?",
                f.memberId, f.islandId);
        jdbc.update("UPDATE group_members SET is_left = false, left_reason = NULL, left_at = NULL,"
                + " rejoined_at = now() WHERE user_id = ? AND group_id = ?",
                f.memberId, f.islandId);

        // 목표를 «다른 값»으로 바꾸면 새 epoch 의 대상은 지금 주민으로 다시 고정된다.
        long version = service.options(f.islandId, f.ownerId).islandVersion();
        service.setTarget(f.islandId, f.ownerId, "library", version, UUID.randomUUID());
        long epoch = states.findById(f.islandId).orElseThrow().getTargetEpoch();

        // 대상 2명 → 각자 ceil(2720/2)=1360 — 재가입 주민의 새 epoch 기여 행이 다시 심겼다.
        tx().executeWithoutResult(status -> {
            walletService.contribute(f.islandId, f.ownerId, 1360, "own2-" + f.islandId);
            walletService.contribute(f.islandId, f.memberId, 1360, "mem2-" + f.islandId);
        });
        assertThat(jdbc.queryForObject("SELECT amount FROM island_construction_contributions "
                        + "WHERE island_id = ? AND epoch = ? AND user_id = ?",
                Integer.class, f.islandId, epoch, f.memberId)).isEqualTo(1360);

        long v2 = service.options(f.islandId, f.ownerId).islandVersion();
        assertThat(service.start(f.islandId, f.ownerId, "library", v2, 1, UUID.randomUUID())
                .status()).isEqualTo("BUILDING");
    }

    // ---------------------------------------------------------------- V100 백필

    @Test
    @DisplayName("V100 백필은 이미 골라져 있던 목표의 대상 명단을 채운다 — 기존 기여 금액은 건드리지 않는다")
    void v90BackfillsCohortOfAlreadySelectedTargets() throws IOException {
        // 백필 «전» 상태를 손으로 만든다: 목표는 걸려 있는데 대상 행은 기여자에게만 있는 모습이다.
        SharedFixture pending = sharedIsland();
        tx().executeWithoutResult(status -> {
            states.insertIfAbsent(pending.islandId);
            states.findByIdForUpdate(pending.islandId).orElseThrow().retarget("gram");
        });
        long epoch = states.findById(pending.islandId).orElseThrow().getTargetEpoch();
        jdbc.update("INSERT INTO island_construction_contributions "
                        + "(island_id, epoch, user_id, amount, updated_at) VALUES (?, ?, ?, ?, now())",
                pending.islandId, epoch, pending.ownerId, 700);
        // 목표가 없는 섬은 대상 자체가 없으므로 백필 대상이 아니다.
        Fixture noTarget = islandOnly();

        jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/"
                + "V100__island_construction_target_cohort_backfill.sql")));

        // 기여자는 금액 그대로, 나머지 당시 주민은 amount=0 대상 행이 새로 생긴다.
        assertThat(jdbc.queryForObject("SELECT amount FROM island_construction_contributions "
                        + "WHERE island_id = ? AND epoch = ? AND user_id = ?",
                Integer.class, pending.islandId, epoch, pending.ownerId))
                .as("ON CONFLICT DO NOTHING — 이미 채운 몫을 지우지 않는다").isEqualTo(700);
        assertThat(jdbc.queryForObject("SELECT amount FROM island_construction_contributions "
                        + "WHERE island_id = ? AND epoch = ? AND user_id = ?",
                Integer.class, pending.islandId, epoch, pending.memberId)).isZero();
        assertThat(contributionCount(noTarget.islandId))
                .as("목표 없는 섬은 채우지 않는다").isZero();

        // 백필 뒤에는 기여가 다시 쌓인다 — 채우지 않으면 갱신할 행이 없어 영영 0 이던 자리다.
        tx().executeWithoutResult(status ->
                walletService.contribute(pending.islandId, pending.memberId, 660, "after-backfill"));
        assertThat(jdbc.queryForObject("SELECT amount FROM island_construction_contributions "
                        + "WHERE island_id = ? AND epoch = ? AND user_id = ?",
                Integer.class, pending.islandId, epoch, pending.memberId)).isEqualTo(660);
    }

    // ---------------------------------------------------------------- 시설

    /** 완공 시설 행을 직접 심는다 — 선행 조건만 채우면 되는 테스트용. */
    private void completeFacility(Fixture f, String buildingId) {
        jdbc.update("INSERT INTO island_facilities (island_id, building_id, status, cost, "
                        + "cost_revision, started_by, started_at, completes_at, completed_at) "
                        + "VALUES (?, ?, 'COMPLETED', 0, 1, ?, now(), now(), now())",
                f.islandId, buildingId, f.ownerId);
    }

    /** 방장 1명 섬 — 상태·지갑 행이 아직 없는 출발점이다. */
    private Fixture islandOnly() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(island)
                .role(GroupMemberRole.OWNER).build());
        return new Fixture(island.getId(), owner.getId());
    }

    /** 방장 1명 섬에 {@code target} 을 목표로 골라 두고 물고기 {@code funds} 를 심는다. */
    private Fixture fundedIsland(int funds, String target) {
        Fixture f = islandOnly();
        // 목표를 먼저 고른다 — 「각자 몫은 목표를 고른 뒤부터」라 목표 없는 적립은
        // 주민별 기여 행을 남기지 않으므로 순서가 결과를 바꾼다.
        chooseTarget(f.islandId, target);
        tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, funds, "seed-" + f.islandId));
        return f;
    }

    /**
     * 목표 선택을 서비스 없이 재현한다 — {@code setTarget} 과 같은 두 쓰기(목표·epoch 갱신과
     * 그 시점 주민 고정)를 한 TX 에서 한다. 고정을 빼면 기여가 대상 행을 못 찾아 쌓이지 않는다.
     */
    private void chooseTarget(UUID islandId, String buildingId) {
        tx().executeWithoutResult(status -> {
            states.insertIfAbsent(islandId);
            IslandConstructionState state = states.findByIdForUpdate(islandId).orElseThrow();
            state.retarget(buildingId);
            contributions.seedCohort(islandId, state.getTargetEpoch(), Instant.now());
        });
    }

    /** 섬에 새 주민 한 명을 들인다 — 목표 선택 뒤의 가입을 재현한다. */
    private UUID joinNewMember(UUID islandId) {
        User joiner = users.save(User.builder().nickname("신규-" + UUID.randomUUID()).build());
        members.save(GroupMember.builder().user(joiner).group(groups.findById(islandId).orElseThrow())
                .role(GroupMemberRole.MEMBER).build());
        return joiner.getId();
    }

    /** 방장 + 일반 주민 1명인 섬 — 권한·재생 권한 상실 시나리오용. */
    private SharedFixture sharedIsland() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        User member = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(island)
                .role(GroupMemberRole.OWNER).build());
        members.save(GroupMember.builder().user(member).group(island)
                .role(GroupMemberRole.MEMBER).build());
        return new SharedFixture(island.getId(), owner.getId(), member.getId());
    }

    private int balance(UUID islandId) {
        return wallets.findById(islandId).orElseThrow().getBalance();
    }

    private long debitCount(UUID islandId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM island_wallet_transactions "
                        + "WHERE island_id = ? AND type = 'CONSTRUCTION_DEBIT'",
                Long.class, islandId);
        return n == null ? 0 : n;
    }

    private long ledgerCount(UUID islandId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM island_wallet_transactions WHERE island_id = ?",
                Long.class, islandId);
        return n == null ? 0 : n;
    }

    private long contributionCount(UUID islandId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM island_construction_contributions WHERE island_id = ?",
                Long.class, islandId);
        return n == null ? 0 : n;
    }

    private long count(String table, UUID islandId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE island_id = ?", Long.class, islandId);
        return n == null ? 0 : n;
    }

    /** PostgreSQL timestamp 의 마이크로초 반올림과 같은 변환 — +500ns 후 잘라낸다. */
    private static Instant toDbMicros(Instant instant) {
        return instant.plusNanos(500).truncatedTo(ChronoUnit.MICROS);
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private record Fixture(UUID islandId, UUID ownerId) {
    }

    private record SharedFixture(UUID islandId, UUID ownerId, UUID memberId) {
    }
}

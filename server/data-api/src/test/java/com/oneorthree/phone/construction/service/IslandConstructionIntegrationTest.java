package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.domain.FacilityStatus;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.repository.domain.IslandFacilityId;
import com.oneorthree.phone.construction.scheduler.IslandConstructionScheduler;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupPermissionScope;
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
        tx().executeWithoutResult(status -> {
            states.insertIfAbsent(f.islandId);
            states.findByIdForUpdate(f.islandId).orElseThrow().retarget("hall");
        });
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
        tx().executeWithoutResult(status -> {
            for (Fixture f : new Fixture[] {a, b}) {
                states.insertIfAbsent(f.islandId);
                states.findByIdForUpdate(f.islandId).orElseThrow().retarget("hall");
            }
        });
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
    @DisplayName("강퇴된 주민의 같은 키 PUT 재생은 403 이다 — 재생 권한은 현재 상태로 다시 검사한다")
    void replayedTargetPutIsForbiddenAfterKick() {
        SharedFixture f = sharedIsland();
        UUID key = UUID.randomUUID();
        service.setTarget(f.islandId, f.memberId, "hall", 0, key);

        // 강퇴 — 활성 멤버십만 없어지고 계정·섬은 살아 있다.
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ? AND group_id = ?",
                f.memberId, f.islandId);

        assertThatThrownBy(() -> service.setTarget(f.islandId, f.memberId, "hall", 0, key))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN);
    }

    @Test
    @DisplayName("지출 권한을 잃은 주민의 같은 키 POST 재생은 403 이다 — OWNER_ONLY 전환 뒤 재생 불가")
    void replayedBuildIsForbiddenAfterSpendPermissionFlip() {
        SharedFixture f = sharedIsland();
        tx().executeWithoutResult(status ->
                walletService.contribute(f.islandId, f.ownerId, 100, "seed-" + f.islandId));
        UUID key = UUID.randomUUID();
        service.start(f.islandId, f.memberId, "hall", 0, 1, key);

        // 방장이 지출 토글을 OWNER_ONLY 로 돌렸다 — 일반 주민의 재생 권한은 사라진다.
        jdbc.update("UPDATE groups SET shared_purchase_permission = 'OWNER_ONLY' WHERE id = ?",
                f.islandId);

        assertThatThrownBy(() -> service.start(f.islandId, f.memberId, "hall", 0, 1, key))
                .isInstanceOf(ConstructionException.class)
                .extracting("errorCode").isEqualTo(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN);
        // 재생이 거절됐으니 추가 차감도 없다.
        assertThat(balance(f.islandId)).isEqualTo(40);
        assertThat(debitCount(f.islandId)).isEqualTo(1);
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
        tx().executeWithoutResult(status -> {
            // 목표를 먼저 고른다 — 「각자 몫은 목표를 고른 뒤부터」라 목표 없는 적립은
            // 주민별 기여 행을 남기지 않으므로 순서가 결과를 바꾼다.
            states.insertIfAbsent(f.islandId);
            states.findByIdForUpdate(f.islandId).orElseThrow().retarget(target);
            walletService.contribute(f.islandId, f.ownerId, funds, "seed-" + f.islandId);
        });
        return f;
    }

    /** 방장 + 일반 주민 1명, 지출 토글 {@code ALL_MEMBERS} 인 섬 — 재생 권한 상실 시나리오용. */
    private SharedFixture sharedIsland() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        User member = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("섬").maxMembers(10)
                .sharedPurchasePermission(GroupPermissionScope.ALL_MEMBERS).build());
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

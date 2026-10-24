package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.service.SessionLogoutService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.service.InternalIslandConstructionService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 건설 내부 표면의 세션 재검사 (GROMO-2207) — 실제 Flyway PostgreSQL·로그아웃 서비스·users 행 잠금으로 검증한다.
 *
 * <p>Business 의 Redis 거부목록은 로그아웃 커밋 뒤에 기록되고 장애 때 fail-open 이다. 이 클래스는 그 창에서
 * 폐기된 세션이 건설 조회·명령·재생을 통과하지 못하는지, 같은 사용자의 다른 세션은 그대로 쓰이는지를 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
// 고유 내부 인증 설정의 컨텍스트가 공유 PostgreSQL에 커넥션 풀을 계속 보유하지 않게 한다.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class InternalIslandConstructionSessionIntegrationTest {
    private static final String TOKEN = "test-construction-business-to-data";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/islands/*/construction-options");
        registry.add("internal.api.callers.business.allow[1]", () -> "PUT /internal/islands/*/construction-target");
        registry.add("internal.api.callers.business.allow[2]", () -> "POST /internal/islands/*/constructions");
    }

    @Autowired
    InternalIslandConstructionService gate;
    @Autowired
    AuthService auth;
    @Autowired
    AuthSessionService sessions;
    @Autowired
    AuthSessionRepository sessionRows;
    @Autowired
    SessionLogoutService logoutService;
    @Autowired
    JwtProvider jwt;
    @Autowired
    UserQueryService userQueries;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    IslandWalletService walletService;
    @Autowired
    IslandWalletRepository wallets;
    @Autowired
    IslandConstructionStateRepository states;
    @Autowired
    PlatformTransactionManager transactions;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @Test
    @DisplayName("① 로그아웃이 users 잠금을 먼저 잡으면 대기하던 건설은 거절되고 PUT 도 거절된다 — 통장·원장·상태·outbox 불변")
    void logoutFirstRejectsCommandsWithoutSideEffects() throws Exception {
        var actor = actor();
        UUID islandId = fundedIsland(actor);
        Ledger before = ledger(islandId, actor.userId());
        var executor = Executors.newSingleThreadExecutor();
        var started = new CountDownLatch(1);
        var pid = new AtomicInteger();
        try {
            Future<?> build = tx().execute(status -> {
                logout(actor);
                Future<?> pending = executor.submit(() -> tx().executeWithoutResult(other -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    gate.start(islandId, actor.userId(), actor.sessionId(), 0L, "hall", 0, 1, UUID.randomUUID());
                }));
                await(started);
                awaitDatabaseLock(pid.get());
                return pending;
            });
            assertThatThrownBy(() -> build.get(20, TimeUnit.SECONDS)).cause()
                    .isInstanceOf(AuthException.class).extracting("errorCode")
                    .isEqualTo(AuthErrorCode.SESSION_NOT_ACTIVE);
        } finally {
            executor.shutdownNow();
        }
        assertSessionNotActive(() -> gate.setTarget(islandId, actor.userId(), actor.sessionId(), 0L, "hall", 0,
                UUID.randomUUID()));
        assertThat(before.balance()).isEqualTo(100);
        assertThat(ledger(islandId, actor.userId())).isEqualTo(before);
    }

    @Test
    @DisplayName("② 건설이 users 잠금을 먼저 잡으면 로그아웃은 기다렸다가 건설 커밋 뒤 성립하고, 같은 키 재생은 거절된다")
    void constructionFirstCommitsThenLogoutRevokes() throws Exception {
        var actor = actor();
        UUID islandId = fundedIsland(actor);
        UUID key = UUID.randomUUID();
        var executor = Executors.newSingleThreadExecutor();
        var started = new CountDownLatch(1);
        var pid = new AtomicInteger();
        try {
            Future<?> logout = tx().execute(status -> {
                gate.start(islandId, actor.userId(), actor.sessionId(), 0L, "hall", 0, 1, key);
                Future<?> pending = executor.submit(() -> tx().executeWithoutResult(other -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    logout(actor);
                }));
                await(started);
                awaitDatabaseLock(pid.get());
                return pending;
            });
            logout.get(20, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
        }
        assertThat(wallets.findById(islandId).orElseThrow().getBalance()).isEqualTo(40);
        assertThat(debitCount(islandId)).isEqualTo(1);
        assertThat(sessionRows.findById(actor.sessionId()).orElseThrow().isActive()).isFalse();

        assertSessionNotActive(() -> gate.start(islandId, actor.userId(), actor.sessionId(), 0L, "hall", 0, 1, key));
        assertThat(debitCount(islandId)).isEqualTo(1);
    }

    @Test
    @DisplayName("③ 성공 receipt 가 있어도 로그아웃 뒤 같은 Idempotency-Key 재전송은 receipt 대신 SESSION_NOT_ACTIVE 다")
    void replayAfterLogoutNeverReturnsTheReceipt() {
        var actor = actor();
        UUID islandId = fundedIsland(actor);
        UUID targetKey = UUID.randomUUID();
        UUID buildKey = UUID.randomUUID();
        var target = gate.setTarget(islandId, actor.userId(), actor.sessionId(), 0L, "hall", 0, targetKey);
        var built = gate.start(islandId, actor.userId(), actor.sessionId(), 0L, "hall", target.version(), 1,
                buildKey);
        assertThat(built.status()).isEqualTo("BUILDING");

        logout(actor);
        Ledger before = ledger(islandId, actor.userId());
        assertSessionNotActive(() -> gate.setTarget(islandId, actor.userId(), actor.sessionId(), 0L, "hall", 0,
                targetKey));
        assertSessionNotActive(() -> gate.start(islandId, actor.userId(), actor.sessionId(), 0L, "hall",
                target.version(), 1, buildKey));
        assertThat(ledger(islandId, actor.userId())).isEqualTo(before);
        assertThat(debitCount(islandId)).isEqualTo(1);
    }

    @Test
    @DisplayName("④ 한 세션의 로그아웃 뒤에도 같은 사용자의 다른 활성 세션은 건설할 수 있고, 옛 세대·타인 sid 는 거절된다")
    void anotherActiveSessionOfTheSameUserStillBuilds() {
        var actor = actor();
        UUID islandId = fundedIsland(actor);
        UUID second = openSecondSession(actor);
        logout(actor);

        var stranger = actor();
        assertSessionNotActive(() -> gate.start(islandId, actor.userId(), second, 1L, "hall", 0, 1,
                UUID.randomUUID()));
        assertSessionNotActive(() -> gate.start(islandId, actor.userId(), stranger.sessionId(), 0L, "hall", 0, 1,
                UUID.randomUUID()));
        var built = gate.start(islandId, actor.userId(), second, 0L, "hall", 0, 1, UUID.randomUUID());
        assertThat(built.status()).isEqualTo("BUILDING");
        assertThat(debitCount(islandId)).isEqualTo(1);
    }

    @Test
    @DisplayName("⑤ GET 옵션도 폐기된 세션이면 SESSION_NOT_ACTIVE 다")
    void optionsRejectRevokedSession() {
        var actor = actor();
        UUID islandId = fundedIsland(actor);
        assertThat(gate.options(islandId, actor.userId(), actor.sessionId(), 0L).villagePoints()).isEqualTo(100);

        logout(actor);
        assertSessionNotActive(() -> gate.options(islandId, actor.userId(), actor.sessionId(), 0L));
    }

    @Test
    @DisplayName("⑥ 세대가 올라가면 같은 활성 세션이라도 옛 gen 은 SESSION_NOT_ACTIVE 고 새 gen 은 통과한다 — 호출자가 잠근 users 행의 현재 세대를 넘겨야 한다")
    void raisedGenerationRejectsOldGenAndAcceptsNewGen() {
        var actor = actor();
        UUID islandId = fundedIsland(actor);
        assertThat(gate.options(islandId, actor.userId(), actor.sessionId(), 0L).villagePoints()).isEqualTo(100);

        // 세션은 폐기하지 않고 세대만 올린다 — 세대 분기만 따로 떼어 본다.
        long newGen = tx().execute(status -> userQueries.getCallerForUpdate(actor.userId()).bumpAuthGeneration());
        assertThat(newGen).isEqualTo(1L);

        // 호출자가 user.getAuthGeneration() 대신 상수를 넘기면 깨지는 유일한 테스트다 (GROMO-2207 핫픽스 회귀 방지).
        assertSessionNotActive(() -> gate.options(islandId, actor.userId(), actor.sessionId(), 0L));
        assertSessionNotActive(() -> gate.setTarget(islandId, actor.userId(), actor.sessionId(), 0L, "hall", 0,
                UUID.randomUUID()));
        assertThat(gate.options(islandId, actor.userId(), actor.sessionId(), newGen).villagePoints()).isEqualTo(100);
    }

    @Test
    @DisplayName("실제 내부 라우트는 X-Session-Id·X-Auth-Generation 이 없으면 400, 폐기된 세션이면 403 SESSION_NOT_ACTIVE 다")
    void internalRoutesRequireSessionHeaders() throws Exception {
        var actor = actor();
        UUID islandId = fundedIsland(actor);
        String base = "/internal/islands/" + islandId;
        Ledger before = ledger(islandId, actor.userId());

        mvc.perform(get(base + "/construction-options").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).header("X-Auth-Generation", 0))
                .andExpect(status().isBadRequest());
        mvc.perform(put(base + "/construction-target").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).header("X-Session-Id", actor.sessionId())
                        .header("Idempotency-Key", UUID.randomUUID()).contentType("application/json")
                        .content("{\"buildingId\":\"hall\",\"expectedVersion\":0}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(base + "/constructions").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json")
                        .content("{\"buildingId\":\"hall\",\"expectedVersion\":0,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isBadRequest());
        assertThat(ledger(islandId, actor.userId())).isEqualTo(before);

        mvc.perform(get(base + "/construction-options").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).header("X-Session-Id", actor.sessionId())
                        .header("X-Auth-Generation", 0))
                .andExpect(status().isOk()).andExpect(jsonPath("$.villagePoints").value(100));
        logout(actor);
        mvc.perform(get(base + "/construction-options").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).header("X-Session-Id", actor.sessionId())
                        .header("X-Auth-Generation", 0))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SESSION_NOT_ACTIVE"));
    }

    // ---------------------------------------------------------------- 도구

    private Actor actor() {
        var login = auth.guestSession(UUID.randomUUID().toString());
        return new Actor(jwt.extractUserId(login.accessToken()), jwt.extractSessionId(login.accessToken()),
                login.refreshToken(), login.accessToken());
    }

    private void logout(Actor actor) {
        logoutService.logout(actor.refreshToken(), actor.accessToken());
    }

    /** 같은 사용자의 두 번째 기기 세션 — 로그인과 같은 순서로 users 를 잠근 뒤 연다. */
    private UUID openSecondSession(Actor actor) {
        String refresh = jwt.generateRefreshToken(actor.userId(), true);
        return tx().execute(status -> {
            userQueries.getCallerForUpdate(actor.userId());
            return sessions.open(actor.userId(), refresh).sessionId();
        });
    }

    /** 실제 세션을 가진 사용자가 방장인 섬에 목표 없이 물고기 100 을 심는다 — 회관(60)은 통장 총액으로 짓는다. */
    private UUID fundedIsland(Actor owner) {
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(users.findById(owner.userId()).orElseThrow()).group(island)
                .role(GroupMemberRole.OWNER).build());
        tx().executeWithoutResult(status ->
                walletService.contribute(island.getId(), owner.userId(), 100, "seed-" + island.getId()));
        return island.getId();
    }

    private static void assertSessionNotActive(ThrowingCallable call) {
        assertThatThrownBy(call).isInstanceOf(AuthException.class).extracting("errorCode")
                .isEqualTo(AuthErrorCode.SESSION_NOT_ACTIVE);
    }

    /** 폐기된 세션의 명령이 남기면 안 되는 흔적 전부 — 통장·원장·시설·목표·receipt·건설 outbox. */
    private Ledger ledger(UUID islandId, UUID userId) {
        return new Ledger(wallets.findById(islandId).orElseThrow().getBalance(),
                count("SELECT COUNT(*) FROM island_wallet_transactions WHERE island_id = ?", islandId),
                count("SELECT COUNT(*) FROM island_facilities WHERE island_id = ?", islandId),
                states.findById(islandId).map(IslandConstructionState::getTargetBuildingId).orElse(null),
                count("SELECT COUNT(*) FROM command_idempotency WHERE user_id = ?", userId),
                count("SELECT COUNT(*) FROM event_outbox WHERE (aggregate_id = ? OR user_id = ?)"
                        + " AND type NOT LIKE 'auth.%'", islandId.toString(), userId));
    }

    private long debitCount(UUID islandId) {
        return count("SELECT COUNT(*) FROM island_wallet_transactions WHERE island_id = ?"
                + " AND type = 'CONSTRUCTION_DEBIT'", islandId);
    }

    private long count(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n == null ? 0 : n;
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }

    /** 스레드 시작과 실제 DB 잠금 대기를 구분한다 — 잠금 없이 우연히 순서가 맞아 통과하지 못하게 한다. */
    private void awaitDatabaseLock(int pid) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (Boolean.TRUE.equals(jdbc.queryForObject("select cardinality(pg_blocking_pids(?)) > 0",
                    Boolean.class, pid))) {
                return;
            }
            Thread.onSpinWait();
        }
        throw new AssertionError("실제 PostgreSQL 잠금 대기가 관측되지 않았습니다.");
    }

    private record Ledger(int balance, long ledger, long facilities, String target, long receipts, long outbox) {
    }

    private record Actor(UUID userId, UUID sessionId, String refreshToken, String accessToken) {
        @Override
        public String toString() {
            return "Actor[credentials=REDACTED]";
        }
    }
}

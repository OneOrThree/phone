package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.SessionLogoutService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupService;
import com.oneorthree.phone.internal.dto.HostTransferRequest;
import com.oneorthree.phone.internal.dto.HostTransferResponse;
import com.oneorthree.phone.internal.service.InternalHostTransferService;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.service.OutboxRelayService;
import com.oneorthree.phone.outbox.service.OutboxRelayStore;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 Flyway PostgreSQL·생산 진입점/명령으로 역할/receipt/outbox와 legacy 경합을 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HostTransferIntegrationTest {
    private static final String TOKEN = "test-host-transfer-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("island-management.host-transfer-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]",
                () -> "POST /internal/islands/*/host-transfer");
    }

    @Autowired
    InternalHostTransferService service;
    @Autowired
    GroupService groups;
    @Autowired
    GroupMemberService members;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    SessionLogoutService logout;
    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    EventOutboxRepository events;
    @Autowired
    EventOutboxDeliveryRepository deliveries;
    @Autowired
    PlatformTransactionManager transactions;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @Test
    @DisplayName("실제 내부 HTTP는 최소 완료 증거만 반환하고 역할·목록 version·REALTIME outbox를 함께 저장한다")
    void internalRouteCommitsOneTransferWithoutLeakingControl() throws Exception {
        Fixture f = fixture();
        long before = version(f);
        var epochs = jdbc.queryForList("select user_id,membership_epoch from group_members where group_id=?"
                + " order by user_id", f.islandId());
        long linkBefore = count("select count(*) from event_outbox where subject_id=? and type like 'link.%'",
                f.islandId().toString());
        mvc.perform(post(path(f)).header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", f.owner().id()).header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content(body(f.owner(), f.target().id())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hostUserId").value(f.target().id().toString()))
                .andExpect(jsonPath("$.version").value(before + 1)).andExpect(jsonPath("$.events").doesNotExist())
                .andExpect(jsonPath("$.data").doesNotExist()).andExpect(jsonPath("$.previousHostUserId").doesNotExist());
        assertOwner(f, f.target());
        assertThat(jdbc.queryForList("select user_id,membership_epoch from group_members where group_id=?"
                + " order by user_id", f.islandId())).isEqualTo(epochs);
        assertThat(count("select count(*) from event_outbox where subject_id=? and type like 'link.%'",
                f.islandId().toString())).isEqualTo(linkBefore);
        assertThat(count("select count(*) from event_outbox e join event_outbox_deliveries d on d.outbox_id=e.id"
                + " where e.subject_id=? and e.type='island.members.updated' and d.target='KAFKA'",
                f.islandId().toString())).isZero();
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and params->>'changeKind'='HOST_TRANSFER'", f.islandId().toString())).isEqualTo(1);
    }

    @Test
    void flagRejectsBeforeAnyReceiptOrDomainWrite() throws Exception {
        Fixture f = fixture();
        long before = version(f);
        long receipts = receiptCount(f.owner());
        ReflectionTestUtils.setField(service, "enabled", false);
        try {
            mvc.perform(post(path(f)).header("Authorization", "Bearer " + TOKEN)
                            .header("X-User-Id", f.owner().id()).header("Idempotency-Key", UUID.randomUUID())
                            .contentType("application/json").content(body(f.owner(), f.target().id())))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("REALTIME_NOT_READY"));
        } finally {
            ReflectionTestUtils.setField(service, "enabled", true);
        }
        assertOwner(f, f.owner());
        assertThat(version(f)).isEqualTo(before);
        assertThat(receiptCount(f.owner())).isEqualTo(receipts);
    }

    @Test
    void unknownFieldsAndNonIntegerGenerationAreRejected() throws Exception {
        Fixture f = fixture();
        for (String body : List.of(body(f.owner(), f.target().id()).replace("0}", "0.0}"),
                body(f.owner(), f.target().id()).replace("}", ",\"role\":\"OWNER\"}"))) {
            mvc.perform(post(path(f)).header("Authorization", "Bearer " + TOKEN)
                            .header("X-User-Id", f.owner().id()).header("Idempotency-Key", UUID.randomUUID())
                            .contentType("application/json").content(body))
                    .andExpect(status().isBadRequest());
        }
        assertOwner(f, f.owner());
    }

    @Test
    void revokedOrForeignSessionCannotExecuteOrReplay() {
        Fixture f = fixture();
        UUID key = UUID.randomUUID();
        transfer(f, key);
        assertThatThrownBy(() -> service.transfer(f.islandId(), f.owner().id(), key,
                new HostTransferRequest(f.target().id(), f.target().sessionId(), 0L)))
                .isInstanceOf(AuthException.class);
        logout.logout(f.owner().refreshToken(), null);
        assertThatThrownBy(() -> transfer(f, key)).isInstanceOf(AuthException.class);
        assertOwner(f, f.target());
    }

    @Test
    void replayAfterLosingHostOrTargetLeavingReturnsOnlyOriginalEvidence() {
        Fixture f = fixture();
        UUID key = UUID.randomUUID();
        var original = transfer(f, key);
        members.transferOwner(f.islandId(), f.owner().id(), f.target().id());
        members.withdrawGroup(f.islandId(), f.target().id());
        withdrawal.withdraw(f.target().id());
        long before = version(f);
        assertThat(transfer(f, key)).isEqualTo(original);
        assertThat(version(f)).isEqualTo(before);
        assertOwner(f, f.owner());
    }

    @Test
    void replayAfterDemotionDoesNotRecheckHostAndChangedBodyConflicts() {
        Fixture f = fixture();
        UUID key = UUID.randomUUID();
        var original = transfer(f, key);
        assertThat(transfer(f, key)).isEqualTo(original);
        assertThatThrownBy(() -> service.transfer(f.islandId(), f.owner().id(), key,
                new HostTransferRequest(f.owner().id(), f.owner().sessionId(), 0L)))
                .isInstanceOf(OutboxException.class);
        assertThat(version(f)).isEqualTo(original.version());
    }

    @Test
    void validatesSelfNonhostAndAbsentTargetWithoutReceipts() {
        Fixture f = fixture();
        long before = receiptCount(f.owner());
        assertThatThrownBy(() -> service.transfer(f.islandId(), f.owner().id(), UUID.randomUUID(),
                new HostTransferRequest(f.owner().id(), f.owner().sessionId(), 0L)))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.CANNOT_TRANSFER_SELF));
        assertThatThrownBy(() -> service.transfer(f.islandId(), f.target().id(), UUID.randomUUID(),
                new HostTransferRequest(f.owner().id(), f.target().sessionId(), 0L)))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.NOT_OWNER));
        assertThatThrownBy(() -> service.transfer(f.islandId(), f.owner().id(), UUID.randomUUID(),
                new HostTransferRequest(UUID.randomUUID(), f.owner().sessionId(), 0L)))
                .isInstanceOf(UserException.class);
        assertThat(receiptCount(f.owner())).isEqualTo(before);
        assertOwner(f, f.owner());
    }

    @Test
    void receiptRoleVersionAndDeliveriesRollbackTogether() {
        Fixture f = fixture();
        UUID key = UUID.randomUUID();
        long before = version(f);
        long receiptBefore = receiptCount(f.owner());
        long eventsBefore = eventCount(f);
        assertThatThrownBy(() -> tx().executeWithoutResult(status -> {
            transfer(f, key);
            throw new IllegalStateException("검증용 commit 전 실패");
        })).isInstanceOf(IllegalStateException.class);
        assertOwner(f, f.owner());
        assertThat(version(f)).isEqualTo(before);
        assertThat(receiptCount(f.owner())).isEqualTo(receiptBefore);
        assertThat(eventCount(f)).isEqualTo(eventsBefore);
        assertThat(transfer(f, key).version()).isEqualTo(before + 1);
    }

    @Test
    void realtimeWithoutRegisteredTransportRemainsDurableAndUnclaimed() {
        Fixture f = fixture();
        transfer(f, UUID.randomUUID());
        var properties = new OutboxRelayProperties();
        var store = new OutboxRelayStore(deliveries, properties, Clock.systemUTC());
        var relay = new OutboxRelayService(store, events, properties, Clock.systemUTC(), List.of());
        long before = eventCount(f);
        assertThat(relay.relayOnce()).isZero();
        assertThat(eventCount(f)).isEqualTo(before);
        assertThat(count("select count(*) from event_outbox_deliveries d join event_outbox e on e.id=d.outbox_id"
                + " where e.subject_id=? and d.target='REALTIME' and d.delivered_at is null"
                + " and d.lease_token is null and d.attempt_count=0", f.islandId().toString())).isEqualTo(before);
    }

    @Test
    void concurrentSameKeyExecutesOnce() throws Exception {
        Fixture f = fixture();
        UUID key = UUID.randomUUID();
        long before = version(f);
        var result = afterBlocked(() -> transfer(f, key), () -> transfer(f, key));
        assertThat(result.version()).isEqualTo(before + 1);
        assertThat(version(f)).isEqualTo(before + 1);
        assertOwner(f, f.target());
    }

    @Test
    void newTransferSerializesWithLegacyTransfer() throws Exception {
        Fixture f = fixture();
        Actor third = actor();
        groups.joinGroup(f.islandId(), third.id(), new JoinGroupRequest(null));
        var failure = afterBlocked(() -> transfer(f, UUID.randomUUID()), () -> failure(() -> {
            members.transferOwner(f.islandId(), third.id(), f.owner().id());
            return null;
        }));
        assertThat(failure).isInstanceOfSatisfying(GroupException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.NOT_OWNER));
        assertOwner(f, f.target());
    }

    @Test
    void legacyKickBeforeTransferMakesTargetMissing() throws Exception {
        Fixture f = fixture();
        Throwable failure = afterBlocked(() -> {
            members.kickMember(f.islandId(), f.target().id(), f.owner().id());
            return null;
        }, () -> failure(() -> transfer(f, UUID.randomUUID())));
        assertThat(failure).isInstanceOfSatisfying(GroupException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.NOT_FOUND));
        assertOwner(f, f.owner());
    }

    @Test
    void transferBeforeKickRevokesOldHostPermission() throws Exception {
        Fixture f = fixture();
        Throwable failure = afterBlocked(() -> transfer(f, UUID.randomUUID()), () -> failure(() -> {
            members.kickMember(f.islandId(), f.target().id(), f.owner().id());
            return null;
        }));
        assertThat(failure).isInstanceOfSatisfying(GroupException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.NOT_OWNER));
    }

    @Test
    void targetAccountWithdrawalBeforeTransferCannotBePromoted() throws Exception {
        Fixture f = fixture();
        Throwable failure = afterBlocked(() -> {
            withdrawal.withdraw(f.target().id());
            return null;
        }, () -> failure(() -> transfer(f, UUID.randomUUID())));
        assertThat(failure).isInstanceOf(UserException.class);
        assertOwner(f, f.owner());
    }

    @Test
    void transferBeforeTargetAccountWithdrawalPreservesRequiredOwner() throws Exception {
        Fixture f = fixture();
        Throwable failure = afterBlocked(() -> transfer(f, UUID.randomUUID()), () -> failure(() -> {
            withdrawal.withdraw(f.target().id());
            return null;
        }));
        assertThat(failure).isInstanceOfSatisfying(GroupException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.HOST_WITHDRAW));
        assertOwner(f, f.target());
    }

    @Test
    void joinAfterLastOwnerLeavesCannotReviveClosedIsland() throws Exception {
        Actor owner = actor();
        Actor newcomer = actor();
        UUID island = groups.createGroup(owner.id(), CreateGroupRequest.builder().name("잠금 검증").build()).groupId();
        Throwable failure = afterBlocked(() -> {
            members.withdrawGroup(island, owner.id());
            return null;
        }, () -> failure(() -> {
            groups.joinGroup(island, newcomer.id(), new JoinGroupRequest(null));
            return null;
        }));
        assertThat(failure).isInstanceOfSatisfying(GroupException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.GROUP_NOT_FOUND));
        assertThat(count("select count(*) from group_members where group_id=? and is_left=false", island)).isZero();
    }

    @Test
    void targetLeavingBeforeTransferCannotBePromoted() throws Exception {
        Fixture f = fixture();
        Throwable failure = afterBlocked(() -> {
            members.withdrawGroup(f.islandId(), f.target().id());
            return null;
        }, () -> failure(() -> transfer(f, UUID.randomUUID())));
        assertThat(failure).isInstanceOfSatisfying(GroupException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.NOT_FOUND));
    }

    private Fixture fixture() {
        Actor owner = actor();
        Actor target = actor();
        UUID island = groups.createGroup(owner.id(), CreateGroupRequest.builder().name("방장 위임 검증").build())
                .groupId();
        groups.joinGroup(island, target.id(), new JoinGroupRequest(null));
        return new Fixture(island, owner, target);
    }

    private Actor actor() {
        var login = auth.guestLogin();
        return new Actor(jwt.extractUserId(login.accessToken()), login.sessionId(), login.refreshToken());
    }

    private HostTransferResponse transfer(Fixture f, UUID key) {
        return service.transfer(f.islandId(), f.owner().id(), key,
                new HostTransferRequest(f.target().id(), f.owner().sessionId(), 0L));
    }

    private long version(Fixture f) {
        return count("select last_version from aggregate_versions where aggregate_type='ISLAND_MEMBERS'"
                + " and aggregate_id=?", f.islandId().toString());
    }

    private long receiptCount(Actor actor) {
        return count("select count(*) from command_idempotency where user_id=?", actor.id());
    }

    private long eventCount(Fixture f) {
        return count("select count(*) from event_outbox where subject_id=? and type='island.members.updated'",
                f.islandId().toString());
    }

    private long count(String sql, Object argument) {
        return jdbc.queryForObject(sql, Long.class, argument);
    }

    private void assertOwner(Fixture f, Actor owner) {
        assertThat(jdbc.queryForList("select user_id from group_members where group_id=?"
                + " and is_left=false and role='OWNER'", UUID.class, f.islandId())).containsExactly(owner.id());
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    /** 선행 실제 TX를 열어 둔 채 후행 PG PID의 잠금 대기를 확인한 뒤에만 커밋한다. */
    private <T> T afterBlocked(Callable<?> first, Callable<T> second) throws Exception {
        var executor = Executors.newSingleThreadExecutor();
        var started = new CountDownLatch(1);
        var pid = new AtomicInteger();
        try {
            var future = tx().execute(status -> {
                call(first);
                var next = executor.submit(() -> tx().execute(ignored -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    T value = call(second);
                    if (value instanceof Throwable) {
                        ignored.setRollbackOnly();
                    }
                    return value;
                }));
                await(started);
                awaitDatabaseLock(pid.get());
                return next;
            });
            return future.get(20, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(20, TimeUnit.SECONDS)).isTrue();
        }
    }

    private static <T> T call(Callable<T> callback) {
        try {
            return callback.call();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static Throwable failure(Callable<?> callback) {
        try {
            callback.call();
            throw new AssertionError("실패해야 하는 명령이 성공했습니다.");
        } catch (Exception e) {
            return e;
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }

    private void awaitDatabaseLock(int pid) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (Boolean.TRUE.equals(jdbc.queryForObject("select cardinality(pg_blocking_pids(?)) > 0",
                    Boolean.class, pid))) {
                return;
            }
            Thread.onSpinWait();
        }
        throw new AssertionError("실제 PostgreSQL 잠금 대기를 관측하지 못했습니다.");
    }

    private static String path(Fixture f) {
        return "/internal/islands/" + f.islandId() + "/host-transfer";
    }

    private static String body(Actor actor, UUID targetId) {
        return "{\"targetUserId\":\"" + targetId + "\",\"sessionId\":\"" + actor.sessionId()
                + "\",\"authGeneration\":0}";
    }

    private record Actor(UUID id, UUID sessionId, String refreshToken) {
    }

    private record Fixture(UUID islandId, Actor owner, Actor target) {
    }
}

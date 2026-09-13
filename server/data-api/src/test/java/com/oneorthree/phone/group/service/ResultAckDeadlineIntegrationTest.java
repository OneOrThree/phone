package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.repository.domain.*;
import com.oneorthree.phone.user.repository.domain.User;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.AbstractDataSource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.Clock;
import java.time.ZoneOffset;
import java.time.LocalDate;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 같은 PostgreSQL에 연결한 두 실제 풀로, 쓰기 인스턴스의 커넥션 고갈과 독립 조회를 재현한다. */
@AutoConfigureMockMvc
@Import(ResultAckDeadlineIntegrationTest.Pools.class)
class ResultAckDeadlineIntegrationTest extends IntegrationTestBase {
    private static final String TOKEN = "ack-deadline-test";
    @DynamicPropertySource
    static void internal(DynamicPropertyRegistry registry) {
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST /internal/users/*/challenge-results/*/ack");
        registry.add("internal.api.callers.business.allow[1]", () -> "GET /internal/users/*/result-ack");
    }
    @Autowired MockMvc mvc;
    @Autowired EntityManager em;
    @Autowired TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;
    @Autowired ChallengeResultAckService service;
    @MockitoBean Clock applicationClock;
    private UUID user;
    private UUID session;
    private UUID token;

    @BeforeEach
    void fixture() {
        when(applicationClock.instant()).thenReturn(Instant.now());
        when(applicationClock.getZone()).thenReturn(ZoneOffset.UTC);
        tx.executeWithoutResult(ignored -> {
            User member = User.builder().nickname("ack-" + UUID.randomUUID()).build();
            em.persist(member);
            Group group = Group.builder().name("ACK 기한").build();
            em.persist(group);
            GroupChallenge challenge = GroupChallenge.builder().group(group).category(MissionCategory.FOCUS)
                    .type(MissionType.DURATION).build();
            em.persist(challenge);
            GroupChallengeBet bet = GroupChallengeBet.builder().group(group).challenge(challenge).stake(10).build();
            em.persist(bet);
            Instant now = Instant.now();
            GroupChallengeBetSession result = GroupChallengeBetSession.builder().bet(bet).group(group)
                    .challenge(challenge).sessionDate(LocalDate.now()).stake(10).goalMinutes(60)
                    .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                    .status(GroupBetStatus.SETTLED).startsAt(now.minusSeconds(7200)).joinClosesAt(now.minusSeconds(7200))
                    .closesAt(now.minusSeconds(3600)).settleAfter(now.minusSeconds(1800)).settledAt(now).build();
            em.persist(result);
            em.persist(GroupChallengeBetParticipant.builder().session(result).user(member).build());
            user = member.getId();
            session = result.getId();
        });
        token = service.claimDisplay(user, session, null).claimToken();
    }

    @Test
    void aConnectionQueuedAckCannotCommitAfterReconciliationHasReleasedIt() throws Exception {
        Instant deadline = databaseNow().plusMillis(500);
        CompletableFuture<Integer> writer;
        try (Connection occupied = Pools.routes.writer.getConnection()) {
            writer = CompletableFuture.supplyAsync(() -> {
                RoutingPool.WRITER.set(true);
                try {
                    return ack(deadline).andReturn().getResponse().getStatus();
                } catch (Exception failure) {
                    throw new IllegalStateException(failure);
                } finally {
                    RoutingPool.WRITER.remove();
                }
            });
            await().atMost(5, TimeUnit.SECONDS).until(() -> Pools.routes.writer.getHikariPoolMXBean().getThreadsAwaitingConnection() == 1);
            assertThat(writer.isDone()).isFalse();
            await().atMost(5, TimeUnit.SECONDS).until(() -> !databaseNow().isBefore(deadline));
            state(deadline).andExpect(status().isOk()).andExpect(jsonPath("$.acknowledged").value(false));
        }
        assertThat(writer.get(5, TimeUnit.SECONDS)).isEqualTo(409);
        assertThat(service.readAckState(user, session).acknowledged()).isFalse();
        ack(databaseNow().plusSeconds(30)).andExpect(status().isOk());
        assertThat(service.readAckState(user, session).acknowledged()).isTrue();
    }

    @Test
    void aNegativeReadBeforeTheWriteDeadlineIsNotAReleaseDecision() throws Exception {
        state(databaseNow().plusSeconds(30)).andExpect(status().is5xxServerError());
        state(databaseNow().minusSeconds(1)).andExpect(status().isOk())
                .andExpect(jsonPath("$.acknowledged").value(false));
    }

    @Test
    void noParticipantIsAlsoUncertainUntilTheDeadline() throws Exception {
        session = UUID.randomUUID();
        state(databaseNow().plusSeconds(30)).andExpect(status().isServiceUnavailable());
        state(databaseNow().minusSeconds(1)).andExpect(status().isOk())
                .andExpect(jsonPath("$.acknowledged").value(false));
    }

    @ParameterizedTest
    @ValueSource(longs = {-86400, 86400})
    void onlyTheDatabaseClockDecidesTheDeadlineAndCompletedAcksRemainIdempotent(long clockSkew) throws Exception {
        when(applicationClock.instant()).thenReturn(databaseNow().plusSeconds(clockSkew));
        ack(databaseNow().minusSeconds(1)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESULT_ACK_DEADLINE_EXPIRED"));
        state(databaseNow().plusSeconds(30)).andExpect(status().isServiceUnavailable());
        ack(databaseNow().plusSeconds(30)).andExpect(status().isOk());
        ack(databaseNow().minusSeconds(1)).andExpect(status().isOk());
        state(databaseNow().plusSeconds(30)).andExpect(status().isOk())
                .andExpect(jsonPath("$.acknowledged").value(true));
    }

    @Test
    void internalRequestsMustCarryADeadline() throws Exception {
        for (String field : new String[]{"", ",\"ackDeadlineAt\":null", ",\"ackDeadlineAt\":\"invalid\""}) {
            mvc.perform(post("/internal/users/" + user + "/challenge-results/" + session + "/ack")
                    .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                    .contentType("application/json").content("{\"claimToken\":\"" + token + "\"" + field + "}"))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(get("/internal/users/" + user + "/result-ack").param("sessionId", session.toString())
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user))
                .andExpect(status().isBadRequest());
        assertThat(service.readAckState(user, session).acknowledged()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void aWriteThatPassedTheDeadlineCheckIsWaitedForUntilCommitOrRollback(boolean rollback) throws Exception {
        Instant deadline = databaseNow().plusMillis(500);
        CountDownLatch written = new CountDownLatch(1);
        CountDownLatch finish = new CountDownLatch(1);
        CompletableFuture<Void> writer = CompletableFuture.runAsync(() -> tx.executeWithoutResult(status -> {
            service.acknowledgeBefore(user, session, token, deadline);
            written.countDown();
            try {
                if (!finish.await(10, TimeUnit.SECONDS)) { throw new IllegalStateException("ACK 해제 시간 초과"); }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(interrupted);
            }
            if (rollback) { status.setRollbackOnly(); }
        }));
        CompletableFuture<ChallengeResultAckService.ResultAckState> reader = null;
        try {
            assertThat(written.await(5, TimeUnit.SECONDS)).isTrue();
            await().atMost(5, TimeUnit.SECONDS).until(() -> !databaseNow().isBefore(deadline));
            reader = CompletableFuture.supplyAsync(() -> service.readAckState(user, session, deadline));
            CompletableFuture<ChallengeResultAckService.ResultAckState> pending = reader;
            assertThatThrownBy(() -> pending.get(300, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        } finally {
            finish.countDown();
            writer.get(5, TimeUnit.SECONDS);
        }
        ChallengeResultAckService.ResultAckState result = reader.get(5, TimeUnit.SECONDS);
        assertThat(result.acknowledged()).isEqualTo(!rollback);
        assertThat(result.acknowledgedAt() != null).isEqualTo(!rollback);
    }

    private Instant databaseNow() {
        return jdbc.queryForObject("SELECT clock_timestamp()", java.sql.Timestamp.class).toInstant();
    }
    private ResultActions ack(Instant deadline) throws Exception {
        return mvc.perform(post("/internal/users/" + user + "/challenge-results/" + session + "/ack")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                .contentType("application/json").content("{\"claimToken\":\"" + token
                        + "\",\"ackDeadlineAt\":\"" + deadline + "\"}"));
    }
    private ResultActions state(Instant deadline) throws Exception {
        return mvc.perform(get("/internal/users/" + user + "/result-ack").param("sessionId", session.toString())
                .param("ackDeadlineAt", deadline.toString())
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Pools {
        static RoutingPool routes;
        @Bean(destroyMethod = "close")
        RoutingPool dataSource(Environment environment) {
            routes = new RoutingPool(environment);
            return routes;
        }
    }
    static class RoutingPool extends AbstractDataSource implements AutoCloseable {
        static final ThreadLocal<Boolean> WRITER = ThreadLocal.withInitial(() -> false);
        final HikariDataSource reader;
        final HikariDataSource writer;
        RoutingPool(Environment environment) {
            reader = pool(environment, 5);
            writer = pool(environment, 1);
        }
        private static HikariDataSource pool(Environment environment, int size) {
            HikariConfig config = new HikariConfig();
            config.setJdbcUrl(environment.getRequiredProperty("spring.datasource.url"));
            config.setUsername(environment.getRequiredProperty("spring.datasource.username"));
            config.setPassword(environment.getRequiredProperty("spring.datasource.password"));
            config.setMaximumPoolSize(size);
            config.setMinimumIdle(0);
            config.setConnectionTimeout(10000);
            return new HikariDataSource(config);
        }
        @Override public Connection getConnection() throws SQLException {
            return (WRITER.get() ? writer : reader).getConnection();
        }
        @Override public Connection getConnection(String username, String password) throws SQLException {
            return getConnection();
        }
        @Override public void close() { writer.close(); reader.close(); }
    }
}

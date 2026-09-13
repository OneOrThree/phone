package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.SessionLogoutService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupService;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 독립 PostgreSQL에 운영 Flyway를 적용하고 실제 필터·HTTP·현재 인가 조회를 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RealtimeMembershipAuthorizationIntegrationTest {
    static final String PATH = "/internal/realtime/membership-authorization";
    static final String REALTIME_TOKEN = "test-realtime-authorization";
    private static final String BUSINESS_TOKEN = "test-miswired-business-authorization";
    private static final String NOTIFICATION_TOKEN = "test-miswired-notification-authorization";
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("realtime_authorization");
        POSTGRES.start();
    }

    /** 이 두 테스트 컨텍스트 전용 DB이며 기존 outbox 테스트의 전수 조회에 행을 남기지 않는다. */
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 6);
        registry.add("spring.datasource.hikari.minimum-idle", () -> 0);
        registry.add("spring.flyway.enabled", () -> true);
        registry.add("spring.flyway.locations", () -> "classpath:db/migration");
        registry.add("spring.flyway.baseline-on-migrate", () -> false);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.realtime.token", () -> REALTIME_TOKEN);
        registry.add("internal.api.callers.realtime.allow[0]", () -> "POST " + PATH);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        database(registry);
        registry.add("internal.realtime.authorization.enabled", () -> true);
        // 허용목록까지 잘못 열어도 controller의 실제 caller 경계가 다시 거절해야 한다.
        registry.add("internal.api.callers.business.token", () -> BUSINESS_TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST " + PATH);
        registry.add("internal.api.callers.notification.token", () -> NOTIFICATION_TOKEN);
        registry.add("internal.api.callers.notification.allow[0]", () -> "POST " + PATH);
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    GroupService groups;
    @Autowired
    GroupMemberService members;
    @Autowired
    SessionLogoutService logout;
    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager transactions;

    @Test
    void activeMemberReturnsOnlyAllowedWithoutWriting() throws Exception {
        Fixture f = fixture();
        var before = rowVersions(f);
        Long events = jdbc.queryForObject("select count(*) from event_outbox", Long.class);
        Long commands = jdbc.queryForObject("select count(*) from command_idempotency", Long.class);

        allowed(f, true);
        allowed(f, true);

        assertThat(rowVersions(f)).isEqualTo(before);
        assertThat(jdbc.queryForObject("select count(*) from event_outbox", Long.class)).isEqualTo(events);
        assertThat(jdbc.queryForObject("select count(*) from command_idempotency", Long.class)).isEqualTo(commands);
    }

    @ParameterizedTest
    @ValueSource(strings = {"generation", "ended", "deleted", "kicked-marker",
            "missing-session", "missing-island", "missing-user"})
    void missingOrInactiveEvidenceReturnsFalse(String change) throws Exception {
        Fixture f = fixture();
        switch (change) {
            case "generation" -> jdbc.update(
                    "update users set auth_generation=auth_generation+1 where id=?", f.userId());
            case "kicked-marker" -> jdbc.update("update group_members set left_reason='KICKED'"
                    + " where group_id=? and user_id=?", f.islandId(), f.userId());
            case "ended" -> jdbc.update("update groups set status='ENDED' where id=?", f.islandId());
            case "deleted" -> jdbc.update("update groups set deleted_at=now() where id=?", f.islandId());
            case "missing-session" -> f = new Fixture(f.userId(), UUID.randomUUID(), f.islandId(), f.ownerId(), f.rt());
            case "missing-island" -> f = new Fixture(f.userId(), f.sid(), UUID.randomUUID(), f.ownerId(), f.rt());
            case "missing-user" -> f = new Fixture(UUID.randomUUID(), f.sid(), f.islandId(), f.ownerId(), f.rt());
            default -> throw new IllegalArgumentException(change);
        }
        allowed(f, false);
    }

    @ParameterizedTest
    @ValueSource(strings = {"logout", "withdraw", "kick", "leave"})
    void committedLifecycleTransitionImmediatelyDenies(String transition) throws Exception {
        Fixture f = fixture();
        allowed(f, true);
        switch (transition) {
            case "logout" -> logout.logout(f.rt(), null);
            case "withdraw" -> withdrawal.withdraw(f.userId());
            case "kick" -> members.kickMember(f.islandId(), f.userId(), f.ownerId());
            case "leave" -> members.withdrawGroup(f.islandId(), f.userId());
            default -> throw new IllegalArgumentException(transition);
        }
        allowed(f, false);
    }

    @Test
    void otherUsersValidSessionOrMembershipNeverAuthorizesSubject() throws Exception {
        Fixture f = fixture();
        Fixture other = fixture();
        allowed(f, true);
        allowed(other, true);
        allowed(new Fixture(f.userId(), other.sid(), f.islandId(), f.ownerId(), f.rt()), false);
        allowed(new Fixture(f.userId(), f.sid(), other.islandId(), other.ownerId(), f.rt()), false);
    }

    @Test
    void serviceCredentialsAndActualCallerRemainIsolated() throws Exception {
        Fixture f = fixture();
        for (String token : List.of(BUSINESS_TOKEN, NOTIFICATION_TOKEN)) {
            request(token, f.userId().toString(), body(f)).andExpect(status().isForbidden());
        }
        request("unknown-service", f.userId().toString(), body(f)).andExpect(status().isUnauthorized());
        var app = auth.guestLogin();
        request(app.accessToken(), f.userId().toString(), body(f)).andExpect(status().isUnauthorized());
        mvc.perform(post(PATH).header("X-User-Id", f.userId()).contentType("application/json").content(body(f)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void malformedSubjectAndProofAreRejected() throws Exception {
        Fixture f = fixture();
        for (String subject : List.of("", "not-a-uuid", "1-1-1-1-1")) {
            request(REALTIME_TOKEN, subject, body(f)).andExpect(status().isBadRequest());
        }
        mvc.perform(post(PATH).header("Authorization", "Bearer " + REALTIME_TOKEN)
                        .contentType("application/json").content(body(f)))
                .andExpect(status().isBadRequest());
        mvc.perform(post(PATH).header("Authorization", "Bearer " + REALTIME_TOKEN)
                        .header("X-User-Id", f.userId(), UUID.randomUUID())
                        .contentType("application/json").content(body(f)))
                .andExpect(status().isBadRequest());
        for (String malformed : List.of("{}", "[]", "null", body(f).replace("0}", "-1}"),
                body(f).replace("0}", "0.0}"), body(f).replace("0}", "\"0\"}"),
                body(f).replace("0}", "null}"), body(f).replace("0}", "9223372036854775808}"),
                body(f).replace("0}", "9007199254740992}"), body(f) + "{}",
                body(f).replace("}", ",\"authGeneration\":0}"),
                body(f).replace(f.sid().toString(), "1-1-1-1-1"),
                body(f).replace("\"" + f.sid() + "\"", "null"),
                body(f).replace("}", ",\"userId\":\"" + UUID.randomUUID() + "\"}"))) {
            request(REALTIME_TOKEN, f.userId().toString(), malformed).andExpect(status().isBadRequest());
        }
    }

    @Test
    void oversizedProofIsRejectedBeforeParsing() throws Exception {
        Fixture f = fixture();
        request(REALTIME_TOKEN, f.userId().toString(), " ".repeat(1025))
                .andExpect(status().isPayloadTooLarge()).andExpect(content().string(""))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    @DisplayName("외부 REPEATABLE_READ의 오래된 snapshot 대신 새 TX에서 커밋된 세션 폐기를 읽는다")
    void staleOuterRepeatableReadCannotHideCommittedRevocation() throws Exception {
        Fixture f = fixture();
        var executor = Executors.newSingleThreadExecutor();
        TransactionTemplate outer = new TransactionTemplate(transactions);
        outer.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        try {
            outer.executeWithoutResult(ignored -> {
                assertThat(sessionActive(f)).isTrue();
                try {
                    executor.submit(() -> logout.logout(f.rt(), null)).get(10, TimeUnit.SECONDS);
                    assertThat(sessionActive(f)).isTrue();
                    allowed(f, false);
                    assertThat(sessionActive(f)).isTrue();
                } catch (Exception e) {
                    throw new IllegalStateException("폐기 후 현재 인가 검증 실패", e);
                }
            });
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    @DisplayName("다른 TX가 네 권위 행을 잠가도 인가는 MVCC 읽기로 잠금 해제 전에 끝난다")
    void authorizationDoesNotWaitForAuthorityRowLocks() throws Exception {
        Fixture f = fixture();
        var executor = Executors.newSingleThreadExecutor();
        try {
            new TransactionTemplate(transactions).executeWithoutResult(ignored -> {
                jdbc.queryForObject("select id from users where id=? for update", UUID.class, f.userId());
                jdbc.queryForObject("select id from auth_sessions where id=? for update", UUID.class, f.sid());
                jdbc.queryForObject("select id from groups where id=? for update", UUID.class, f.islandId());
                jdbc.queryForObject("select id from group_members where group_id=? and user_id=? for update",
                        UUID.class, f.islandId(), f.userId());
                try {
                    executor.submit(() -> {
                        allowed(f, true);
                        return true;
                    }).get(3, TimeUnit.SECONDS);
                } catch (Exception e) {
                    throw new IllegalStateException("인가 조회가 권위 행의 잠금 해제를 기다렸습니다", e);
                }
            });
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private Fixture fixture() {
        var owner = auth.guestLogin();
        var member = auth.guestLogin();
        UUID ownerId = jwt.extractUserId(owner.accessToken());
        UUID userId = jwt.extractUserId(member.accessToken());
        UUID islandId = groups.createGroup(ownerId,
                CreateGroupRequest.builder().name("현재 수신 자격 검증").build()).groupId();
        groups.joinGroup(islandId, userId, new JoinGroupRequest(null));
        return new Fixture(userId, member.sessionId(), islandId, ownerId, member.refreshToken());
    }

    private List<String> rowVersions(Fixture f) {
        return jdbc.queryForList("select u.xmin::text || ':' || s.xmin::text || ':' || g.xmin::text"
                + " || ':' || m.xmin::text from users u join auth_sessions s on s.user_id=u.id"
                + " join group_members m on m.user_id=u.id join groups g on g.id=m.group_id"
                + " where u.id=? and s.id=? and g.id=?", String.class, f.userId(), f.sid(), f.islandId());
    }

    private boolean sessionActive(Fixture f) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select revoked_at is null from auth_sessions where id=?",
                Boolean.class, f.sid()));
    }

    private void allowed(Fixture f, boolean value) throws Exception {
        request(REALTIME_TOKEN, f.userId().toString(), body(f)).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().json("{\"allowed\":" + value + "}",
                        org.springframework.test.json.JsonCompareMode.STRICT));
    }

    private ResultActions request(String token, String userId, String body) throws Exception {
        return mvc.perform(post(PATH).header("Authorization", "Bearer " + token).header("X-User-Id", userId)
                .contentType("application/json").content(body));
    }

    private static String body(Fixture f) {
        return "{\"sessionId\":\"" + f.sid() + "\",\"islandId\":\"" + f.islandId() + "\",\"authGeneration\":0}";
    }

    private record Fixture(UUID userId, UUID sid, UUID islandId, UUID ownerId, String rt) {
    }
}

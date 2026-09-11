package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.exception.AccessCredentialException;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.service.SessionLogoutService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.internal.dto.SessionLogoutRequest;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 Flyway PostgreSQL·JWT·필터·서비스로 RT 종료의 원자성 및 응답 유실을 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
// 고유 내부 인증 설정의 컨텍스트가 공유 PostgreSQL에 커넥션 풀을 계속 보유하지 않게 한다.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SessionLogoutIntegrationTest {
    private static final String PATH = "/internal/auth/sessions/logout";
    private static final String SERVICE_TOKEN = "test-business-session-logout";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> SERVICE_TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST " + PATH);
        registry.add("internal.api.callers.notification.token", () -> "test-notification-session-logout");
        registry.add("internal.api.callers.notification.allow[0]", () -> "POST /internal/auth/sessions/verify");
    }

    @Autowired
    SessionLogoutService service;
    @Autowired
    AuthService auth;
    @Autowired
    AuthSessionService sessions;
    @Autowired
    AuthSessionRepository sessionRows;
    @Autowired
    EventOutboxRepository events;
    @Autowired
    UserQueryService users;
    @Autowired
    JwtProvider jwt;
    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;
    @Autowired
    PlatformTransactionManager transactions;
    @Value("${jwt.secret}")
    String secret;

    @Test
    @DisplayName("실제 내부 필터는 business만 수락하고 RT-only 응답은 plain revoked다")
    void authenticatedInternalSurface() throws Exception {
        Actor actor = actor();
        String body = body(actor.refreshToken(), null);
        mvc.perform(post(PATH).contentType("application/json").content(body)).andExpect(status().isUnauthorized());
        mvc.perform(post(PATH).header("Authorization", "Bearer test-notification-session-logout")
                        .contentType("application/json").content(body)).andExpect(status().isForbidden());
        mvc.perform(post(PATH).header("Authorization", "Bearer " + SERVICE_TOKEN)
                        .header("X-User-Id", UUID.randomUUID()).contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revoked").value(true))
                .andExpect(jsonPath("$.data").doesNotExist()).andExpect(jsonPath("$.refreshToken").doesNotExist());
    }

    @Test
    @DisplayName("폐기 증거와 epoch·bootstrap 폐기는 한 번이며 기기 삭제와 세대 상승은 없다")
    void exactEvidenceReplay() {
        Actor actor = actor();
        long before = row(actor).getSessionEpoch();
        service.logout(actor.refreshToken(), null);
        var stopped = row(actor);
        assertThat(stopped.isActive()).isFalse();
        assertThat(stopped.getSessionEpoch()).isGreaterThan(before);
        assertThat(stopped.getLogoutRefreshExpiresAt())
                .isEqualTo(jwt.extractExpiration(actor.refreshToken()).toInstant());
        assertThat(stopped.getRevokeReason()).isEqualTo("LOGOUT");
        assertThat(stopped.getBootstrapNonceHash()).isNotBlank();
        service.logout(actor.refreshToken(), null);
        assertThat(row(actor).getSessionEpoch()).isEqualTo(stopped.getSessionEpoch());
        assertThat(row(actor).getRevokedAt()).isEqualTo(stopped.getRevokedAt());
        assertThat(revocationCount(actor)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select auth_generation from users where id=?", Long.class, actor.userId()))
                .isZero();
        assertThat(events.findAll().stream().filter(e -> actor.userId().equals(e.getUserId()))
                .map(e -> e.getType())).containsExactly("auth.session.revoked");
        tx().executeWithoutResult(status -> assertThat(sessions.verifySession(actor.userId(), actor.sessionId())
                .orElseThrow().isActive()).isFalse());
    }

    @Test
    @DisplayName("유효한 sid RT·AT는 같은 세션과 현재 세대를 증명해야 한다")
    void sessionBoundCredentials() {
        Actor actor = withRefresh(actor(), true, Instant.now().plusSeconds(3600));
        String access = token(actor.userId().toString(), "access", actor.sessionId(), 0L,
                Instant.now().plusSeconds(3600));
        service.logout(actor.refreshToken(), access);
        service.logout(actor.refreshToken(), access);
        assertThat(revocationCount(actor)).isEqualTo(1);
    }

    @Test
    @DisplayName("sid 없는 legacy AT·RT는 같은 사용자만 허용하고 혼합 sid는 거절한다")
    void legacyAndMixedCredentials() {
        Actor legacy = actor();
        assertAccessRejected(legacy, jwt.generateAccessToken(legacy.userId(), true, 0L, legacy.sessionId()));
        Actor sid = withRefresh(actor(), true, Instant.now().plusSeconds(3600));
        assertAccessRejected(sid, jwt.generateAccessToken(sid.userId(), true));
        service.logout(legacy.refreshToken(), jwt.generateAccessToken(legacy.userId(), true));
        assertThat(row(legacy).isActive()).isFalse();
    }

    @Test
    @DisplayName("타 사용자·타 세션·옛 세대·만료·refresh 타입의 동봉 AT는 종료하지 않는다")
    void invalidOptionalAccess() {
        Actor actor = withRefresh(actor(), true, Instant.now().plusSeconds(3600));
        Instant future = Instant.now().plusSeconds(3600);
        for (String access : new String[]{
                token(UUID.randomUUID().toString(), "access", actor.sessionId(), 0L, future),
                token(actor.userId().toString(), "access", UUID.randomUUID(), 0L, future),
                token(actor.userId().toString(), "access", actor.sessionId(), 1L, future),
                token(actor.userId().toString(), "access", actor.sessionId(), 0L, Instant.now().minusSeconds(10)),
                actor.refreshToken(), "broken", ""}) {
            assertAccessRejected(actor, access);
        }
    }

    @Test
    @DisplayName("RT 서명·필수 exp·엄격 UUID·sid/gen 타입과 범위를 검증한다")
    void invalidRefreshClaims() {
        Actor actor = actor();
        Instant future = Instant.now().plusSeconds(3600);
        for (String refresh : new String[]{"broken", "", jwt.generateAccessToken(actor.userId(), true),
                token(actor.userId().toString(), "refresh", null, null, null),
                token("1-1-1-1-1", "refresh", null, null, future),
                token(actor.userId().toString(), "refresh", "1-1-1-1-1", 0L, future),
                token(actor.userId().toString(), "refresh", actor.sessionId(), 0.5, future),
                token(actor.userId().toString(), "refresh", actor.sessionId(), -1L, future),
                token(actor.userId().toString(), "refresh", actor.sessionId(), null, future),
                token(actor.userId().toString(), "refresh", null, null, Instant.now().minusSeconds(10))}) {
            assertThatThrownBy(() -> service.logout(refresh, null)).isInstanceOf(InvalidTokenException.class);
        }
        assertThat(row(actor).isActive()).isTrue();
        assertThat(revocationCount(actor)).isZero();
    }

    @Test
    @DisplayName("해시는 일치해도 RT sid 또는 generation이 다르면 종료하지 않는다")
    void mismatchedStoredRefresh() {
        Actor actor = actor();
        for (String bad : new String[]{token(actor.userId().toString(), "refresh", UUID.randomUUID(), 0L,
                Instant.now().plusSeconds(3600)), token(actor.userId().toString(), "refresh", actor.sessionId(), 1L,
                Instant.now().plusSeconds(3600))}) {
            replaceRefresh(actor, bad);
            assertThatThrownBy(() -> service.logout(bad, null)).isInstanceOf(InvalidTokenException.class);
        }
        assertThat(row(actor).isActive()).isTrue();
    }

    @Test
    @DisplayName("세션행 없는 실제 legacy 해시는 종료행으로 백필하고 동일 증거를 재생한다")
    void absentLegacySession() {
        Actor actor = actor();
        jdbc.update("delete from auth_sessions where id=?", actor.sessionId());
        service.logout(actor.refreshToken(), null);
        service.logout(actor.refreshToken(), null);
        var stopped = sessionRows.findByRefreshTokenHash(TokenHasher.sha256Hex(actor.refreshToken())).orElseThrow();
        assertThat(stopped.isLegacy()).isTrue();
        assertThat(stopped.isActive()).isFalse();
        assertThat(stopped.getBootstrapNonceHash()).isNull();
        assertThat(stopped.getLogoutRefreshExpiresAt()).isNotNull();
        assertThat(revocationCount(actor)).isEqualTo(1);
    }

    @Test
    @DisplayName("legacy 종료 proof null과 타 사유 폐기는 새 종료 재생으로 인정하지 않는다")
    void rejectsOtherRevocationsAndLegacyProof() {
        Actor legacy = actor();
        auth.logout(new LogoutRequest(legacy.refreshToken()));
        assertThatThrownBy(() -> service.logout(legacy.refreshToken(), null)).isInstanceOf(InvalidTokenException.class);
        Actor other = actor();
        tx().executeWithoutResult(status -> sessions.revokeAll(other.userId(), "LOGOUT_ALL"));
        assertThatThrownBy(() -> service.logout(other.refreshToken(), null)).isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("실제 탈퇴 뒤 같은 RT는 완료 증거가 있어도 USER_NOT_FOUND다")
    void withdrawalWinsOverReplay() throws Exception {
        Actor actor = actor();
        service.logout(actor.refreshToken(), null);
        withdrawal.withdraw(actor.userId());
        assertThatThrownBy(() -> service.logout(actor.refreshToken(), null)).isInstanceOf(UserException.class);
        mvc.perform(post(PATH).header("Authorization", "Bearer " + SERVICE_TOKEN).contentType("application/json")
                        .content(body(actor.refreshToken(), null))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
    }

    @Test
    @DisplayName("A 종료는 B의 최신 RT·활성 세션·refresh를 유지한다")
    void leavesAnotherSessionAlive() {
        Actor actor = actor();
        String second = jwt.generateRefreshToken(actor.userId(), true);
        UUID secondId = tx().execute(status -> {
            users.getCallerForUpdate(actor.userId()).setRefreshTokenHash(TokenHasher.sha256Hex(second));
            return sessions.open(actor.userId(), second).sessionId();
        });
        service.logout(actor.refreshToken(), null);
        assertThat(sessionRows.findById(secondId).orElseThrow().isActive()).isTrue();
        assertThat(auth.refreshToken(second).accessToken()).isNotBlank();
        assertThatThrownBy(() -> auth.refreshToken(actor.refreshToken())).isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("바깥 TX rollback은 users 해시·epoch·종료 증거·outbox를 모두 되돌린다")
    void transactionRollback() {
        Actor actor = actor();
        long before = row(actor).getSessionEpoch();
        tx().executeWithoutResult(status -> {
            service.logout(actor.refreshToken(), null);
            status.setRollbackOnly();
        });
        assertThat(row(actor).isActive()).isTrue();
        assertThat(row(actor).getSessionEpoch()).isEqualTo(before);
        assertThat(row(actor).getLogoutRefreshExpiresAt()).isNull();
        assertThat(revocationCount(actor)).isZero();
        assertThat(auth.refreshToken(actor.refreshToken()).accessToken()).isNotBlank();
    }

    @Test
    @DisplayName("동시 종료 두 요청은 실제 users 잠금에서 대기하고 한 증거·outbox로 수렴한다")
    void concurrentLogoutUsesDatabaseLock() throws Exception {
        Actor actor = actor();
        var executor = Executors.newSingleThreadExecutor();
        try {
            var future = tx().execute(status -> {
                service.logout(actor.refreshToken(), null);
                CountDownLatch started = new CountDownLatch(1);
                AtomicInteger pid = new AtomicInteger();
                var pending = executor.submit(() -> tx().executeWithoutResult(inner -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    service.logout(actor.refreshToken(), null);
                }));
                await(started);
                awaitDatabaseLock(pid.get());
                return pending;
            });
            future.get(20, TimeUnit.SECONDS);
            assertThat(revocationCount(actor)).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    @DisplayName("회전이 먼저 확정되면 잠금 대기한 옛 RT 종료는 새 해시를 폐기하지 않는다")
    void refreshCommitsBeforeLogout() throws Exception {
        Actor actor = withRefresh(actor(), false, Instant.now().plusSeconds(60));
        var executor = Executors.newSingleThreadExecutor();
        try {
            var future = tx().execute(status -> {
                users.getCallerForUpdate(actor.userId());
                var rotated = auth.refreshToken(actor.refreshToken());
                assertThat(rotated.refreshToken()).isNotBlank();
                CountDownLatch started = new CountDownLatch(1);
                AtomicInteger pid = new AtomicInteger();
                var pending = executor.submit(() -> tx().executeWithoutResult(inner -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    assertThatThrownBy(() -> service.logout(actor.refreshToken(), null))
                            .isInstanceOf(InvalidTokenException.class);
                    inner.setRollbackOnly();
                }));
                await(started);
                awaitDatabaseLock(pid.get());
                return pending;
            });
            future.get(20, TimeUnit.SECONDS);
            assertThat(row(actor).isActive()).isTrue();
            assertThat(revocationCount(actor)).isZero();
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    @DisplayName("입력 DTO와 오류 응답은 자격을 직렬화하거나 toString에 출력하지 않는다")
    void strictBodyAndSafeErrors() throws Exception {
        Actor actor = actor();
        assertThat(new SessionLogoutRequest(actor.refreshToken(), "private-access").toString())
                .doesNotContain(actor.refreshToken(), "private-access");
        for (String invalid : new String[]{"{}", "[]", "{\"refreshToken\":123}",
                "{\"refreshToken\":null}", body(actor.refreshToken(), null).replace("}", ",\"extra\":true}"),
                "{\"refreshToken\":\"token\",\"accessToken\":123}"}) {
            mvc.perform(post(PATH).header("Authorization", "Bearer " + SERVICE_TOKEN)
                            .contentType("application/json").content(invalid)).andExpect(status().isBadRequest());
        }
        mvc.perform(post(PATH).header("Authorization", "Bearer " + SERVICE_TOKEN).contentType("application/json")
                        .content(body("bad-refresh", null))).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("REFRESH_TOKEN"));
        mvc.perform(post(PATH).header("Authorization", "Bearer " + SERVICE_TOKEN).contentType("application/json")
                        .content(body(actor.refreshToken(), "bad-access"))).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    private Actor actor() {
        var login = auth.guestLogin();
        return new Actor(jwt.extractUserId(login.accessToken()), login.sessionId(), login.refreshToken());
    }

    private Actor withRefresh(Actor actor, boolean withSid, Instant expires) {
        String refresh = token(actor.userId().toString(), "refresh", withSid ? actor.sessionId() : null,
                withSid ? 0L : null, expires);
        replaceRefresh(actor, refresh);
        return new Actor(actor.userId(), actor.sessionId(), refresh);
    }

    private void replaceRefresh(Actor actor, String refresh) {
        String hash = TokenHasher.sha256Hex(refresh);
        tx().executeWithoutResult(status -> {
            jdbc.update("update users set refresh_token_hash=? where id=?", hash, actor.userId());
            jdbc.update("update auth_sessions set refresh_token_hash=? where id=?", hash, actor.sessionId());
        });
    }

    private String token(String subject, String type, Object sid, Object generation, Instant expiration) {
        var builder = Jwts.builder().subject(subject).id(UUID.randomUUID().toString()).claim("type", type);
        if (sid != null) {
            builder.claim("sid", sid.toString());
        }
        if (generation != null) {
            builder.claim("gen", generation);
        }
        if (expiration != null) {
            builder.expiration(Date.from(expiration));
        }
        return builder.signWith(Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private com.oneorthree.phone.auth.repository.domain.AuthSession row(Actor actor) {
        return sessionRows.findById(actor.sessionId()).orElseThrow();
    }

    private long revocationCount(Actor actor) {
        return events.findAll().stream().filter(e -> actor.userId().equals(e.getUserId()))
                .filter(e -> "auth.session.revoked".equals(e.getType())).count();
    }

    private static String body(String refresh, String access) {
        return "{\"refreshToken\":\"" + refresh + "\""
                + (access == null ? "" : ",\"accessToken\":\"" + access + "\"") + "}";
    }

    private void assertAccessRejected(Actor actor, String access) {
        assertThatThrownBy(() -> service.logout(actor.refreshToken(), access))
                .isInstanceOf(AccessCredentialException.class);
        assertThat(row(actor).isActive()).isTrue();
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

    private record Actor(UUID userId, UUID sessionId, String refreshToken) {
        @Override
        public String toString() {
            return "Actor[credentials=REDACTED]";
        }
    }
}

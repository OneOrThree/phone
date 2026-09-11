package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * 다중 세션 갱신 계약 — 실물 PostgreSQL + <b>실제 Flyway V52</b> 위에서 고정한다 (A22 ㋣ · ㋞ · ㋪).
 *
 * <p><b>무엇을 되풀이하지 않기 위한 테스트인가.</b> {@code users.refresh_token_hash} 는 유저당 하나라,
 * 같은 계정이 B 기기에서 다시 로그인하면 로그인 경로가 그 값을 B 의 것으로 덮는다. 갱신이 그 해시를
 * <b>먼저</b> 보면 A 기기의 {@code auth_sessions} 행이 멀쩡히 살아 있어도 A 의 갱신이 401 이 되고,
 * A 는 AT 만료와 함께 강제 로그아웃된다(codex R10 P1). 세션 축을 도입한 의미가 통째로 사라지는
 * 회귀라 여기서 실 DB 로 못 박는다.
 *
 * <p>목을 쓰지 않는 이유: 깨지는 자리가 <b>두 경로가 같은 행을 두고 만나는 지점</b>이라 한쪽만
 * 세우면 언제나 초록이다. 로그인·갱신·로그아웃을 전부 생산 배선으로 돌린다.
 *
 * <p>컨테이너는 {@link OutboxTestPostgres} 공유 인스턴스다 — {@code create-drop} 이 아니라 운영
 * 마이그레이션으로 띄워야 {@code uq_auth_sessions_refresh_token_hash} 같은 제약까지 함께 검증된다.
 */
@SpringBootTest
class MultiSessionRefreshIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    AuthService authService;
    @Autowired
    AuthSessionRepository authSessionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    JwtProvider jwtProvider;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    DataSource dataSource;

    @Value("${jwt.secret}")
    String jwtSecret;

    /**
     * 회전 판정을 «참»으로 만드는 RT 발급기.
     *
     * <p>{@code isRefreshRotationDue} 는 「남은 수명 &lt; 설정 수명의 절반」이다. 운영 설정(30일)으로
     * 발급한 RT 는 방금 만든 것이라 언제나 거짓이므로, 같은 서명키로 <b>수명만 짧게</b> 준 토큰을
     * 따로 찍는다. 서명·클레임 구조는 같아서 검증 경로는 전부 그대로 탄다.
     */
    private JwtProvider shortLivedMinter() {
        return new JwtProvider(jwtSecret, 3600L, 600L, 600L);
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    // ── 시나리오 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("B 기기 로그인이 유저 단일 해시를 가져가도 A 기기의 갱신은 살아 있다 (codex R10 P1)")
    void refreshOnFirstDeviceSurvivesSecondDeviceLogin() {
        TwoDevices devices = loginTwice("multi-session-survive");

        // 로그인 순서상 유저 단일 해시는 B 의 것이다 — 그 전제가 깨지면 이 테스트는 아무것도 안 지킨다
        assertThat(currentUserHash(devices.userId()))
                .as("두 번째 로그인이 users.refresh_token_hash 를 덮었어야 한다")
                .isEqualTo(TokenHasher.sha256Hex(devices.refreshTokenB()));

        // when: A 기기가 갱신한다 — 종전 코드는 여기서 InvalidTokenException 이었다
        TokenRefreshResponse refreshed = authService.refreshToken(devices.refreshTokenA());

        // then: A 세션의 sid 로 AT 가 나오고, 수명이 넉넉해 회전은 일어나지 않는다
        assertThat(refreshed.accessToken()).isNotBlank();
        assertThat(refreshed.sessionId()).isEqualTo(devices.sessionIdA());
        assertThat(refreshed.refreshToken()).isNull();

        // 그리고 B 도 그대로 산다 — 「한쪽을 살리려고 다른 쪽을 끊었다」가 아니다
        assertThat(authService.refreshToken(devices.refreshTokenB()).sessionId())
                .isEqualTo(devices.sessionIdB());
    }

    @Test
    @DisplayName("A 세션의 회전은 B 가 가진 유저 단일 해시를 덮지 않고, 회전된 옛 RT 는 부활하지 않는다")
    void rotatingOneSessionLeavesTheOtherSingletonAndKillsTheOldToken() {
        TwoDevices devices = loginTwice("multi-session-rotate");
        // A 세션이 「곧 만료」 RT 를 쥔 상태로 만든다 — 세션 행의 해시만 그 토큰으로 바꾼다
        String expiringA = shortLivedMinter().generateRefreshToken(devices.userId(), false);
        rebindSessionRefreshToken(devices.sessionIdA(), expiringA);

        // when
        TokenRefreshResponse rotated = authService.refreshToken(expiringA);

        // then ① A 는 회전했다
        assertThat(rotated.refreshToken()).isNotBlank();
        assertThat(rotated.sessionId()).isEqualTo(devices.sessionIdA());
        AuthSession sessionA = authSessionRepository.findById(devices.sessionIdA()).orElseThrow();
        assertThat(sessionA.getRefreshTokenHash()).isEqualTo(TokenHasher.sha256Hex(rotated.refreshToken()));
        assertThat(sessionA.isActive()).isTrue();

        // ② B 의 세션도, B 가 쥔 유저 단일 해시도 그대로다 — 덮으면 B 의 구 RT 경로가 끊긴다
        assertThat(currentUserHash(devices.userId()))
                .isEqualTo(TokenHasher.sha256Hex(devices.refreshTokenB()));
        assertThat(authSessionRepository.findById(devices.sessionIdB()).orElseThrow().getRefreshTokenHash())
                .isEqualTo(TokenHasher.sha256Hex(devices.refreshTokenB()));
        assertThat(authService.refreshToken(devices.refreshTokenB()).sessionId())
                .isEqualTo(devices.sessionIdB());

        // ③ 회전으로 죽은 옛 RT 는 «구 RT 승격 경로로도» 되살아나지 않는다
        assertThatThrownBy(() -> authService.refreshToken(expiringA))
                .as("세션 행에도 없고 유저 해시와도 어긋나므로 승격 대상이 아니다")
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("마지막 로그인 기기가 회전하면 유저 단일 해시도 함께 전진한다 — 옛 RT 승격 부활 차단")
    void rotatingTheSingletonOwnerAdvancesTheUserHash() {
        // 기기 하나만 — 이 세션이 곧 단일 해시의 주인이다
        SocialLoginResponse login = login(newProviderId("multi-session-singleton"), null);
        UUID userId = ownerOf(login.sessionId());
        String expiring = shortLivedMinter().generateRefreshToken(userId, false);
        rebindSessionRefreshToken(login.sessionId(), expiring);
        rebindUserRefreshToken(userId, expiring);

        // when
        TokenRefreshResponse rotated = authService.refreshToken(expiring);

        // then: 유저 해시가 새 RT 로 옮겨가야 한다. 안 옮기면 옛 RT 가 유저 행에 남아,
        // 세션 해시가 회전한 뒤 「세션 없는 구 RT」로 보여 승격 경로로 부활한다.
        assertThat(currentUserHash(userId)).isEqualTo(TokenHasher.sha256Hex(rotated.refreshToken()));
        assertThatThrownBy(() -> authService.refreshToken(expiring))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("A 기기 로그아웃은 A 세션만 끊는다 — A 의 갱신은 401, B 는 그대로 (A22 ㋞)")
    void logoutRevokesOnlyThatSession() {
        TwoDevices devices = loginTwice("multi-session-logout");

        // when: A 기기만 로그아웃 (기기 토큰 없는 구 앱 형태)
        authService.logout(new LogoutRequest(devices.refreshTokenA()));

        // then: A 세션은 폐기되고 갱신이 막힌다
        assertThat(authSessionRepository.findById(devices.sessionIdA()).orElseThrow().isActive()).isFalse();
        assertThatThrownBy(() -> authService.refreshToken(devices.refreshTokenA()))
                .isInstanceOf(InvalidTokenException.class);

        // 그리고 B 는 끊기지 않는다 — 종전 단일 해시 구조에서는 여기가 「전부 끊김」이었다
        assertThat(authSessionRepository.findById(devices.sessionIdB()).orElseThrow().isActive()).isTrue();
        assertThat(authService.refreshToken(devices.refreshTokenB()).sessionId())
                .isEqualTo(devices.sessionIdB());
    }

    @Test
    @DisplayName("세션 행 없는 구 RT 는 첫 갱신에서 legacy 세션으로 승격되고 자격을 처음 발급받는다 (A22 ㋪)")
    void legacyRefreshTokenIsPromotedOnFirstRefresh() {
        // given: 세션 축 이전의 상태 — users 해시만 있고 auth_sessions 행이 없다
        UUID userId = tx().execute(status ->
                userRepository.save(User.builder().build()).getId());
        String legacyRefreshToken = jwtProvider.generateRefreshToken(userId, false);
        rebindUserRefreshToken(userId, legacyRefreshToken);
        assertThat(authSessionRepository.findByRefreshTokenHash(
                TokenHasher.sha256Hex(legacyRefreshToken))).isEmpty();

        // when
        TokenRefreshResponse promoted = authService.refreshToken(legacyRefreshToken);

        // then ① 남은 수명과 무관하게 «항상» 회전한다 — 여기가 세션 축에 올리는 유일한 자리다
        assertThat(promoted.refreshToken()).isNotBlank();
        assertThat(promoted.sessionId()).isNotNull();
        // ② 자격은 승격 때 처음 발급된다(구 앱은 아직 이 값을 갖고 있지 않다)
        assertThat(promoted.deviceBootstrap()).isNotBlank();

        AuthSession session = authSessionRepository.findById(promoted.sessionId()).orElseThrow();
        assertThat(session.isLegacy()).as("백필 행은 legacy 표시가 있어야 무토큰 이전 예외가 열리지 않는다").isTrue();
        assertThat(session.getUserId()).isEqualTo(userId);
        assertThat(session.getRefreshTokenHash()).isEqualTo(TokenHasher.sha256Hex(promoted.refreshToken()));
        assertThat(session.getBootstrapNonceHash())
                .isEqualTo(TokenHasher.sha256Hex(promoted.deviceBootstrap()));

        // ③ 유저 단일 해시도 함께 전진해, 승격에 쓰인 구 RT 는 두 번 쓰이지 않는다
        assertThat(currentUserHash(userId)).isEqualTo(TokenHasher.sha256Hex(promoted.refreshToken()));
        assertThatThrownBy(() -> authService.refreshToken(legacyRefreshToken))
                .isInstanceOf(InvalidTokenException.class);

        // ④ 승격된 RT 는 이제 세션 축으로 갱신된다
        assertThat(authService.refreshToken(promoted.refreshToken()).sessionId())
                .isEqualTo(promoted.sessionId());
    }

    @Test
    @DisplayName("같은 RT 로 동시 회전 두 건 — 정확히 하나만 성공하고 세션은 승자의 RT 를 든다")
    void concurrentRotationOfTheSameSessionHasExactlyOneWinner() throws Exception {
        SocialLoginResponse login = login(newProviderId("multi-session-race"), null);
        UUID userId = ownerOf(login.sessionId());
        String expiring = shortLivedMinter().generateRefreshToken(userId, false);
        rebindSessionRefreshToken(login.sessionId(), expiring);
        rebindUserRefreshToken(userId, expiring);

        // 두 «커넥션»으로 동시에 회전을 건다. 한 스레드에서 순서를 바꿔 흉내 내면 잠금이 전혀
        // 관여하지 않아, 직렬화가 빠져도 초록이 된다.
        List<TokenRefreshResponse> successes = new ArrayList<>();
        List<Throwable> failures = new ArrayList<>();
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<?>> calls = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                calls.add(pool.submit((Callable<Void>) () -> {
                    await(startTogether);
                    Throwable thrown = catchThrowable(() -> {
                        TokenRefreshResponse response = authService.refreshToken(expiring);
                        synchronized (successes) {
                            successes.add(response);
                        }
                    });
                    if (thrown != null) {
                        synchronized (failures) {
                            failures.add(thrown);
                        }
                    }
                    return null;
                }));
            }
            for (Future<?> call : calls) {
                call.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        // 둘 다 성공하면 먼저 응답받은 클라이언트는 «이미 죽은 RT» 를 쥔 채 남는다 — 그게 이
        // 단언이 막는 회귀다. 직렬화는 users 행 배타 락이 한다(갱신·로그아웃·탈퇴·로그인 공통).
        assertThat(successes).hasSize(1);
        assertThat(failures).hasSize(1);
        assertThat(failures.get(0)).isInstanceOf(InvalidTokenException.class);

        AuthSession session = authSessionRepository.findById(login.sessionId()).orElseThrow();
        assertThat(session.getRefreshTokenHash())
                .isEqualTo(TokenHasher.sha256Hex(successes.get(0).refreshToken()));
        assertThat(session.isActive()).isTrue();
    }

    // ── 준비물 ───────────────────────────────────────────────────────────

    /** 두 기기 로그인 결과 — B 가 나중이라 {@code users.refresh_token_hash} 는 B 의 것이다. */
    private record TwoDevices(UUID userId, String refreshTokenA, UUID sessionIdA,
                              String refreshTokenB, UUID sessionIdB) {
    }

    private TwoDevices loginTwice(String label) {
        String providerId = newProviderId(label);
        SocialLoginResponse deviceA = login(providerId, null);
        SocialLoginResponse deviceB = login(providerId, deviceA);
        return new TwoDevices(ownerOf(deviceA.sessionId()),
                deviceA.refreshToken(), deviceA.sessionId(),
                deviceB.refreshToken(), deviceB.sessionId());
    }

    /** 컨테이너가 JVM 전역 공유라 소셜 키는 매번 새로 만든다 — 재실행이 앞선 행을 만나지 않게. */
    private String newProviderId(String label) {
        return label + ":" + UUID.randomUUID();
    }

    /**
     * 생산 로그인 경로를 그대로 탄다 — 소셜 클라이언트(외부 검증)만 건너뛴다.
     * 같은 {@code providerId} 로 두 번째로 부르면 <b>같은 유저</b>에 붙으면서 유저 단일 해시를 덮는다.
     */
    private SocialLoginResponse login(String providerId, SocialLoginResponse previous) {
        SocialLoginResponse response = authService.loginOrRegister(Provider.KAKAO, providerId, null, null);
        assertThat(response.refreshToken()).isNotBlank();
        assertThat(response.sessionId()).isNotNull();
        if (previous != null) {
            assertThat(response.isNewUser())
                    .as("두 번째 로그인은 같은 계정이어야 한다 — 다르면 단일 해시 덮어쓰기가 재현되지 않는다")
                    .isFalse();
            assertThat(response.refreshToken())
                    .as("두 번째 로그인은 새 RT·새 세션이어야 한다").isNotEqualTo(previous.refreshToken());
            assertThat(response.sessionId()).isNotEqualTo(previous.sessionId());
        }
        return response;
    }

    private UUID ownerOf(UUID sessionId) {
        return authSessionRepository.findById(sessionId).orElseThrow().getUserId();
    }

    private String currentUserHash(UUID userId) {
        return userRepository.findById(userId).orElseThrow().getRefreshTokenHash();
    }

    /**
     * 세션 행이 인정하는 RT 를 바꿔 끼운다 — 회전 판정이 참이 되는 상태를 만들기 위한 준비다.
     * 검증 대상({@code rotateIfCurrent})으로 준비하면 그 메서드가 고장나도 초록이 되므로 raw SQL 로 쓴다.
     */
    private void rebindSessionRefreshToken(UUID sessionId, String refreshToken) {
        executeUpdate("UPDATE auth_sessions SET refresh_token_hash = ? WHERE id = ?",
                TokenHasher.sha256Hex(refreshToken), sessionId);
    }

    private void rebindUserRefreshToken(UUID userId, String refreshToken) {
        executeUpdate("UPDATE users SET refresh_token_hash = ? WHERE id = ?",
                TokenHasher.sha256Hex(refreshToken), userId);
    }

    private void executeUpdate(String sql, String hash, UUID id) {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, hash);
            statement.setObject(2, id);
            assertThat(statement.executeUpdate()).isEqualTo(1);
        } catch (Exception e) {
            throw new IllegalStateException("테스트 준비 SQL 실패: " + sql, e);
        }
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}

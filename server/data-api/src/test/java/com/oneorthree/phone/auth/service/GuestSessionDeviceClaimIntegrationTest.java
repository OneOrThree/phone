package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.GuestDeviceClaimRepository;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 게스트 기기 점유 통합 테스트 (GROMO-2036) — <b>같은 기기의 재시도가 계정을 하나 더 만들지 않는지</b>
 * 를 실 DB 의 SQL count 로 고정한다.
 *
 * <p>JPA {@code count()} 가 아니라 <b>SQL</b> 로 세는 이유: 영속성 컨텍스트·플러시 타이밍이 끼면
 * 「행이 정말 늘었는가」가 아니라 「이 세션이 무엇을 보고 있는가」를 재는 것이 된다. 여기서 확인하려는
 * 것은 커밋된 행 수 자체다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는다 — {@code guestSession} 은 유니크 위반 재시도를 위해
 * <b>트랜잭션 밖</b>에서 시작하고 안쪽 두 호출이 각자 커밋한다. 테스트가 바깥 트랜잭션을 열면 그
 * 구조가 통째로 다른 것이 된다({@link GuestPromotionConcurrencyTest} 와 같은 판단). 데이터는
 * {@code @AfterEach} 에서 직접 지운다.
 */
class GuestSessionDeviceClaimIntegrationTest extends IntegrationTestBase {

    @Autowired
    AuthService authService;
    @Autowired
    UserRepository userRepository;
    @Autowired
    GuestDeviceClaimRepository guestDeviceClaimRepository;
    @Autowired
    AuthSessionRepository authSessionRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Autowired
    UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    JdbcTemplate jdbc;

    private final List<String> claimedDigests = new ArrayList<>();
    private final List<UUID> createdUsers = new ArrayList<>();

    @AfterEach
    void tearDown() {
        claimedDigests.forEach(guestDeviceClaimRepository::deleteById);
        createdUsers.forEach(userId -> {
            authSessionRepository.findActiveByUserId(userId).forEach(authSessionRepository::delete);
            userWalletRepository.deleteById(userId);
            userScreenTimeSettingsRepository.deleteById(userId);
            userFocusTimeSettingsRepository.deleteById(userId);
            userNotificationSettingsRepository.deleteById(userId);
            userRepository.deleteById(userId);
        });
    }

    /**
     * <b>이 파일의 핵심 단언이다</b> — 티켓 2036 의 「같은 기기 식별자로 두 번 호출해도 users 행이
     * 하나만 늘어난다」.
     *
     * <p>유실된 201 의 재시도가 계정을 둘 만들면 사용자는 첫 계정의 고양이·섬·집중 기록을 잃고,
     * 앱이 모르는 계정이 하나 DB 에 남는다.
     */
    @Test
    @DisplayName("같은 기기 digest 로 두 번 발급해도 users 행은 하나만 늘고 같은 userId 를 준다")
    void issuingTwiceForTheSameDeviceAddsExactlyOneUserRow() {
        String digest = digest("aaaa");
        long usersBefore = countUsers();

        AuthService.LoginSessionResult first = issue(digest);
        AuthService.LoginSessionResult second = issue(digest);

        assertThat(countUsers() - usersBefore)
                .as("같은 기기의 재시도는 계정을 하나 더 만들지 않는다")
                .isEqualTo(1);
        assertThat(second.userId()).isEqualTo(first.userId());
        assertThat(countClaims(digest)).isEqualTo(1);
    }

    /**
     * 재발급은 <b>토큰을 재생하지 않고 새 세션을 연다</b>.
     *
     * <p>{@code login_attempts} 와 달리 이 원장은 고정 서명 재료를 담지 않는다(담지 않는 것이 설계다 —
     * V87 주석 ②). 그래서 두 번째 호출은 같은 계정의 <b>다른</b> 세션이고, 토큰도 다르다. 앱이 마지막
     * 응답을 저장하면 되고 앞선 세션은 자기 RT 로 계속 산다(A22 ㋣).
     */
    @Test
    @DisplayName("재발급은 같은 계정에 새 세션을 연다 — 토큰을 그대로 재생하지 않는다")
    void reissuingOpensANewSessionInsteadOfReplayingTheSameTokens() {
        String digest = digest("bbbb");

        AuthService.LoginSessionResult first = issue(digest);
        AuthService.LoginSessionResult second = issue(digest);

        assertThat(second.accessToken()).isNotEqualTo(first.accessToken());
        assertThat(second.refreshToken()).isNotEqualTo(first.refreshToken());
        assertThat(second.deviceBootstrap())
                .as("새 세션이면 자격도 새로 발급된다 — 재사용하면 두 세션이 같은 fence 를 공유한다")
                .isNotEqualTo(first.deviceBootstrap());
        assertThat(authSessionRepository.findActiveByUserId(first.userId()))
                .as("앞선 세션은 폐기되지 않는다 — 개별 기기 로그아웃만 세션을 끊는다")
                .hasSize(2);
    }

    /** 다른 기기는 다른 계정이다 — 점유의 축이 기기라는 것의 반대편 단언이다. */
    @Test
    @DisplayName("다른 기기 digest 는 계정을 각각 만든다")
    void issuingForTwoDevicesAddsTwoUserRows() {
        long usersBefore = countUsers();

        AuthService.LoginSessionResult a = issue(digest("cccc"));
        AuthService.LoginSessionResult b = issue(digest("dddd"));

        assertThat(countUsers() - usersBefore).isEqualTo(2);
        assertThat(a.userId()).isNotEqualTo(b.userId());
    }

    /**
     * 새 게스트는 부속 4행까지 함께 생긴다 — {@code guestLogin} 과 같은 경로를 탄다는 증명이다.
     *
     * <p>여기서 갈리면 2.0 게스트만 지갑·설정 없이 태어나, 이후 조회가 빈 값을 만나 엉뚱한 곳에서 터진다.
     */
    @Test
    @DisplayName("2.0 게스트도 지갑·설정 부속 4행을 갖고 태어난다")
    void createsTheFourSideRowsJustLikeTheLegacyGuestPath() {
        AuthService.LoginSessionResult issued = issue(digest("eeee"));

        assertThat(userWalletRepository.findById(issued.userId())).isPresent();
        assertThat(userScreenTimeSettingsRepository.findById(issued.userId())).isPresent();
        assertThat(userFocusTimeSettingsRepository.findById(issued.userId())).isPresent();
        assertThat(userNotificationSettingsRepository.findById(issued.userId())).isPresent();
        assertThat(userRepository.findById(issued.userId())).get()
                .extracting(user -> user.isGuest()).isEqualTo(true);
    }

    /**
     * 복구 창이 지난 점유는 <b>버리고 새 계정을 만든다</b> (계정 LLD §3 Q06 보존).
     *
     * <p>창을 과거로 밀어 만료를 재현한다. 무기한으로 두면 기기 식별자가 게스트 계정의 영구 bearer
     * 자격이 되는데, 그 복구 수단은 아직 승인되지 않았다.
     */
    @Test
    @DisplayName("복구 창이 지난 기기 digest 는 새 계정을 받는다")
    void releasesTheClaimOnceTheRecoveryWindowHasPassed() {
        String digest = digest("ffff");
        AuthService.LoginSessionResult first = issue(digest);

        jdbc.update("UPDATE guest_device_claims SET recovery_expires_at = now() - interval '1 minute'"
                + " WHERE device_digest = ?", digest);

        AuthService.LoginSessionResult second = issue(digest);

        assertThat(second.userId()).isNotEqualTo(first.userId());
        assertThat(countClaims(digest)).as("점유는 같은 PK 로 재사용된다 — 행이 늘지 않는다").isEqualTo(1);
    }

    /**
     * 2.0 갱신은 <b>회전하지 않는다</b> (GROMO-2035 · 계정 LLD §3).
     *
     * <p>발급 직후의 RT 는 회전 시점이 아니므로 이 단언만으로는 미회전 «강제» 를 증명하지 못한다 —
     * 그래서 함께 확인하는 것은 <b>세션이 그대로라는 사실</b>이다. 회전이 일어났다면 세션 행의 RT
     * 해시가 바뀌어 원 RT 의 다음 갱신이 401 이 된다.
     */
    @Test
    @DisplayName("2.0 갱신은 RT 를 회전시키지 않고 같은 RT 를 계속 쓸 수 있다")
    void refreshingOnTheTwoPointZeroSurfaceNeverRotatesTheRefreshToken() {
        AuthService.LoginSessionResult issued = issue(digest("1111"));

        var first = authService.refreshSessionAccessToken(issued.refreshToken());
        var second = authService.refreshSessionAccessToken(issued.refreshToken());

        assertThat(first.refreshToken()).as("미회전 응답은 refreshToken 이 null 이다").isNull();
        assertThat(second.refreshToken()).isNull();
        assertThat(second.accessToken()).isNotBlank();
    }

    /** 세션 없는 구 RT 승격은 2.0 표면에 없다 — 복구 불가능한 승격을 새 경로에서 열지 않는다. */
    @Test
    @DisplayName("2.0 갱신은 위조·미등록 RT 를 401 로 끊는다")
    void rejectsARefreshTokenThatNoLiveSessionBacks() {
        AuthService.LoginSessionResult issued = issue(digest("2222"));
        // 세션 행을 지워 「이미 교체됐거나 폐기된 RT」와 같은 상태를 만든다.
        authSessionRepository.findActiveByUserId(issued.userId()).forEach(authSessionRepository::delete);

        assertThatThrownBy(() -> authService.refreshSessionAccessToken(issued.refreshToken()))
                .isInstanceOfSatisfying(InvalidTokenException.class, error ->
                        assertThat(error.getErrorCode()).isEqualTo(InvalidTokenErrorCode.REFRESH_TOKEN));
    }

    /**
     * 게스트 발급도 1회용 자격을 실어 보낸다 (GROMO-2037 · 계정 LLD §2.1).
     *
     * <p>Business 가 이 값을 {@code X-Device-Bootstrap} 헤더로 앱에 넘긴다. 자격이 「있다」만 보면
     * 안 된다 — 값이 세션 행의 fence 와 다르면 앱은 자격을 «받았다»고 믿고 기기 등록에 실어 보내는데
     * 알림 서버는 그 값의 SHA-256 으로 fence 를 서므로 어느 기기도 자기 세션에 붙지 못한다. 그래서
     * <b>원문의 해시가 그 세션 행의 값과 같다</b>까지 단언한다.
     *
     * <p>원문은 DB 어디에도 없다는 것도 여기서 함께 고정한다 — 저장하면 DB 유출이 곧 소유권 이전
     * 자격 유출이다(V52 주석).
     */
    @Test
    @DisplayName("게스트 발급은 1회용 자격을 싣고, 그 해시만 세션 행에 남는다")
    void carriesOneShotBootstrapWhoseHashIsFencedOnTheSessionRow() {
        AuthService.LoginSessionResult issued = issue(digest("cccc"));

        assertThat(issued.deviceBootstrap()).isNotBlank();
        assertThat(authSessionRepository.findActiveByUserId(issued.userId()))
                .singleElement()
                .satisfies(session -> assertThat(session.getBootstrapNonceHash())
                        .isEqualTo(TokenHasher.sha256Hex(issued.deviceBootstrap())));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM auth_sessions WHERE bootstrap_nonce_hash = ?",
                Long.class, issued.deviceBootstrap()))
                .as("원문은 저장하지 않는다 — 저장하면 DB 유출이 곧 자격 유출이다")
                .isZero();
    }

    // ---------------------------------------------------------------- 도구

    private AuthService.LoginSessionResult issue(String digest) {
        AuthService.LoginSessionResult issued = authService.guestSession(digest);
        claimedDigests.add(digest);
        if (!createdUsers.contains(issued.userId())) {
            createdUsers.add(issued.userId());
        }
        return issued;
    }

    /** 64자 hex — 실제 digest 와 같은 모양이면 충분하다. 값 자체에 의미는 없다. */
    private static String digest(String seed) {
        return (seed + "2036").repeat(8).substring(0, 64);
    }

    private long countUsers() {
        return jdbc.queryForObject("SELECT count(*) FROM users", Long.class);
    }

    private long countClaims(String digest) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM guest_device_claims WHERE device_digest = ?", Long.class, digest);
    }
}

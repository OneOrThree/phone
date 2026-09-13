package com.oneorthree.business.usecase;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import com.oneorthree.business.auth.AccessTokenClaims;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 세션 확인과 기기 등록 «사이»에 그 세션이 끝나는 경합.
 *
 * <p>확인이 성공한 직후 Data 의 세션 행 잠금은 응답과 함께 풀리고 등록은 별도 호출로 나중에
 * 실행된다. 그 사이에 로그아웃이 커밋되면, 폐기 사건이 알림 서버에 아직 도착하지 않은 동안에는
 * 그쪽 {@code session_fences} 에 tombstone 이 없어 등록이 성공한다 — 그 상태로 발송이 끼어들면
 * 로그아웃한 기기로 비공개 알림이 간다.
 *
 * <p>폐기 사건이 도착하면 알림 서버가 그 행까지 비활성화하므로 영구 구멍은 아니지만, 남는 창의
 * 길이를 relay 지연이 정한다. Business 가 등록 직후 한 번 더 확인해 그 창을 왕복 한 번으로 줄인다.
 */
@DisplayName("확인과 등록 사이의 세션 종료")
class DeviceRegistrationSessionRaceTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID SESSION = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final String BOOTSTRAP = "boot-nonce";
    private static final String TOKEN = "fcm-token";

    @Autowired
    private DeviceTokenUseCase useCase;

    private void stubRegister() {
        NOTI.on("POST /internal/devices",
                request -> new MockUpstream.Response(200, "{\"ownershipToken\":\"" + UUID.randomUUID() + "\"}"));
    }

    private void register() {
        useCase.register(new AccessTokenClaims(USER, false, 1L, SESSION), TOKEN, null, BOOTSTRAP,
                RequestIdempotencyKeys.from(UUID.randomUUID().toString()),
                Deadline.startingNow(Duration.ofSeconds(10)));
    }

    /** 구 앱 요청 — 자격({@code deviceBootstrap})이 없고 AT 의 {@code sid} 만 있다. */
    private void registerAsLegacyApp() {
        useCase.register(new AccessTokenClaims(USER, false, 1L, SESSION), TOKEN, null, null,
                RequestIdempotencyKeys.from(UUID.randomUUID().toString()),
                Deadline.startingNow(Duration.ofSeconds(10)));
    }

    /**
     * 확인은 통과했는데 등록 뒤 다시 보니 세션이 끝나 있다 — 방금 등록한 토큰을 즉시 되돌려야 한다.
     * relay 가 폐기 사건을 나를 때까지 기다리면 그동안 그 기기로 푸시가 간다.
     */
    @Test
    @DisplayName("등록 중 세션이 끝나면 방금 등록한 토큰을 즉시 삭제한다")
    void aSessionThatEndsDuringRegistrationHasItsFreshTokenRevokedImmediately() {
        stubActiveUser(USER);
        stubRegister();
        AtomicInteger checks = new AtomicInteger();
        // 첫 확인은 활성, 등록 뒤의 재확인은 비활성 — 그 사이에 로그아웃이 커밋된 것이다.
        DATA.on("POST /internal/auth/device-sessions/verify", request -> new MockUpstream.Response(200,
                checks.getAndIncrement() == 0 ? "{\"active\":true,\"sessionEpoch\":1}"
                        : "{\"active\":false,\"sessionEpoch\":2}"));

        register();

        assertThat(checks.get()).as("등록 뒤 한 번 더 확인해야 한다").isEqualTo(2);
        assertThat(NOTI.hits("DELETE /internal/devices"))
                .as("폐기 사건을 기다리지 않고 그 자리에서 되돌린다")
                .isEqualTo(1);
    }

    /**
     * 같은 경합이 «구 앱 경로»에도 있다. 자격이 없어 sid 로 판정한 요청도 {@code verifySession()} 통과
     * 직후 로그아웃될 수 있고, 그 등록은 sid 로 키가 잡힌 fence 를 쓰므로 폐기 relay 가 닿기 전까지
     * 살아 있다 — 재확인 축이 자격 하나뿐이면 이 창이 통째로 열린 채 남는다.
     */
    @Test
    @DisplayName("자격 없는 구 앱 등록도 sid 축으로 재확인해 되돌린다")
    void aLegacySessionThatEndsDuringRegistrationIsRevokedToo() {
        stubActiveUser(USER);
        stubRegister();
        AtomicInteger checks = new AtomicInteger();
        DATA.on("POST /internal/auth/sessions/verify", request -> new MockUpstream.Response(200,
                checks.getAndIncrement() == 0 ? "{\"active\":true,\"sessionEpoch\":1}"
                        : "{\"active\":false,\"sessionEpoch\":2}"));

        registerAsLegacyApp();

        assertThat(checks.get()).as("구 앱 경로도 등록 뒤 같은 sid 를 다시 확인해야 한다").isEqualTo(2);
        assertThat(NOTI.hits("DELETE /internal/devices"))
                .as("확인 직후 로그아웃한 구 앱 기기의 토큰도 그 자리에서 되돌린다")
                .isEqualTo(1);
        assertThat(DATA.hits("POST /internal/auth/device-sessions/verify"))
                .as("자격이 없으니 자격 축은 건드리지 않는다 — 확인한 축으로만 다시 확인한다")
                .isZero();
    }

    /** 구 앱 세션이 멀쩡하면 되돌리지 않는다 — 재확인이 정상 로그인을 깨면 안 된다. */
    @Test
    @DisplayName("구 앱 세션이 살아 있으면 되돌리지 않는다")
    void aLiveLegacySessionKeepsItsRegistration() {
        stubActiveUser(USER);
        stubRegister();
        DATA.on("POST /internal/auth/sessions/verify",
                request -> new MockUpstream.Response(200, "{\"active\":true,\"sessionEpoch\":1}"));

        registerAsLegacyApp();

        assertThat(NOTI.hits("DELETE /internal/devices")).isZero();
    }

    /** 세션이 멀쩡하면 아무것도 되돌리지 않는다 — 정상 로그인에 삭제가 끼면 안 된다. */
    @Test
    @DisplayName("세션이 살아 있으면 되돌리지 않는다")
    void aLiveSessionKeepsItsRegistration() {
        stubActiveUser(USER);
        stubRegister();
        DATA.on("POST /internal/auth/device-sessions/verify",
                request -> new MockUpstream.Response(200, "{\"active\":true,\"sessionEpoch\":1}"));

        register();

        assertThat(NOTI.hits("DELETE /internal/devices")).isZero();
    }
}

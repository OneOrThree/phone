package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 기기 등록의 «응답 유실 뒤 재시도» 회귀.
 *
 * <p>두 가지를 함께 고정한다: ① RT 회전으로 {@code sessionEpoch} 만 바뀐 재시도는 저장된 소유권을
 * 그대로 재생한다(GROMO-1659 R0 P2), ② 그 재생이 fencing 을 건너뛰지 않는다 — 폐기된 세션 · 낡은
 * 세대 · 달라진 의도는 여전히 거절된다. 그리고 오프라인에 쌓인 토큰 교체 2건이 앱의 소유권 승계와
 * 함께 완주하는지(R0 P1) 서버 계약 쪽에서 같이 못 박는다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class DeviceReplayTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("22222222-2222-4222-8222-222222222222");
    static final UUID OTHER = UUID.fromString("33333333-3333-4333-8333-333333333333");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired DeviceService devices;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE commands,device_tokens,session_fences,legacy_session_fences,"
                + "user_fences CASCADE");
    }

    /**
     * 등록이 커밋되고 응답만 유실된 뒤 RT 가 회전하면 재시도는 <b>같은 의도 · 새 epoch</b> 로 온다
     * ({@code AuthSession.rotate()} 는 bootstrap 자격을 그대로 두고 epoch 만 전진시킨다).
     * 본문 전체 해시였을 때 이 재시도는 영구 {@code IDEMPOTENCY_KEY_CONFLICT} 였다.
     */
    @Test
    void rotatedSessionEpochReplaysStoredOwnershipWithoutRewritingState() {
        String owner = register(USER, "device", "bootstrap", 1L, 0L, "same-key");
        Map<String, Object> before = store.one("SELECT * FROM device_tokens WHERE device_token='device'");

        assertThat(register(USER, "device", "bootstrap", 2L, 0L, "same-key")).isEqualTo(owner);

        // 재생은 아무것도 쓰지 않는다 — 소유권도 fence 도 첫 요청이 남긴 값 그대로다.
        assertThat(store.one("SELECT * FROM device_tokens WHERE device_token='device'"))
                .containsEntry("ownership_version", before.get("ownership_version"))
                .containsEntry("ownership_token", before.get("ownership_token"))
                .containsEntry("session_epoch", 1L);
        assertThat(store.one("SELECT * FROM session_fences WHERE bootstrap_hash=?", Json.digest("bootstrap")))
                .containsEntry("epoch", 1L).containsEntry("used", true);
    }

    /** 재생이라도 의도가 다르면 같은 키를 쓸 수 없다 — 기기 · 소유권은 멱등 비교 기준에 남아 있다. */
    @Test
    void changedIntentUnderTheSameKeyStillConflicts() {
        String owner = register(USER, "device", "bootstrap", 1L, 0L, "same-key");
        assertThatThrownBy(() -> register(USER, "other-device", "bootstrap", 2L, 0L, "same-key"))
                .hasMessage("IDEMPOTENCY_KEY_CONFLICT");
        assertThatThrownBy(() -> devices.register(USER, body("device", "bootstrap", 2L, 0L, owner), "same-key"))
                .hasMessage("IDEMPOTENCY_KEY_CONFLICT");
    }

    /** 폐기된 세션의 재시도는 옛 성공 응답을 받지 못한다 — 재생 직전에 세션 축을 «지금» 값으로 다시 본다. */
    @Test
    void replayAfterSessionRevocationIsRejected() {
        register(USER, "device", "bootstrap", 1L, 0L, "same-key");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("bootstrapNonceHash", Json.digest("bootstrap"));
        params.put("sessionEpoch", 2L);
        devices.revokeSession(USER, params);

        assertThatThrownBy(() -> register(USER, "device", "bootstrap", 3L, 0L, "same-key"))
                .hasMessage("SESSION_REVOKED");
    }

    /** 세대가 오른 뒤의 재시도도 마찬가지다 — 세대는 의도에 남아 있고, 낡은 세대는 재생 전에 걸린다. */
    @Test
    void replayAfterGenerationBumpIsRejected() {
        register(USER, "device", "bootstrap", 1L, 0L, "same-key");
        devices.generation(USER, 1L, false);

        assertThatThrownBy(() -> register(USER, "device", "bootstrap", 2L, 0L, "same-key"))
                .hasMessage("STALE_AUTH_GENERATION");
        assertThatThrownBy(() -> register(USER, "device", "bootstrap", 2L, 1L, "same-key"))
                .hasMessage("IDEMPOTENCY_KEY_CONFLICT");
    }

    /**
     * 오프라인에 fcm-old · fcm-new 등록이 함께 쌓인 경우. 앱이 선행 등록의 소유권을 후속 명령에
     * 승계해야 완주한다 — 승계 없이 등록 당시의 자격만 들고 오면 1회용 자격은 이미 소비됐다.
     */
    @Test
    void offlineTokenRotationCompletesOnlyWithInheritedOwnership() {
        String owner = register(USER, "fcm-old", "bootstrap", 1L, 0L, "key-old");

        assertThatThrownBy(() -> register(USER, "fcm-new", "bootstrap", 1L, 0L, "key-new"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");
        assertThat(devices.register(USER, body("fcm-new", "bootstrap", 1L, 0L, owner), "key-new"))
                .containsKey("ownershipToken");

        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='fcm-old'"))
                .containsEntry("active", false);
        assertThat(store.one("SELECT active,bootstrap_hash FROM device_tokens WHERE device_token='fcm-new'"))
                .containsEntry("active", true).containsEntry("bootstrap_hash", Json.digest("bootstrap"));
    }

    /** 다른 계정은 같은 키로도 남의 응답을 재생하지 못하고, 남의 소유권을 승계하지도 못한다. */
    @Test
    void otherUserNeitherReplaysNorInheritsOwnership() {
        String owner = register(USER, "device", "bootstrap", 1L, 0L, "same-key");

        // 멱등 범위가 유저별이라 재생 자체가 없고, 남의 세션 자격은 세션 축에서 걸린다.
        assertThatThrownBy(() -> register(OTHER, "device", "bootstrap", 1L, 0L, "same-key"))
                .hasMessage("SESSION_REVOKED");
        // 남의 소유권을 승계할 수도 없다 — 승계는 같은 유저의 행에서만 성립한다.
        assertThatThrownBy(() -> devices.register(OTHER, body("device", null, 1L, 0L, owner), "other-key"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");
        assertThat(store.one("SELECT user_id FROM device_tokens WHERE device_token='device'"))
                .containsEntry("user_id", USER);
    }

    /**
     * 구 앱은 {@code deviceBootstrap} 을 저장하지 않아 {@code {deviceToken}} 만 보내지만, 그 앱이 쓰는
     * AT 도 새 {@code AuthService} 가 발급하므로 {@code gen=0} 이 함께 실려 온다. 그 gen 을 「소유권
     * 프로토콜을 지원하는 앱」의 표지로 쓰면 구 앱의 <b>최초 등록과 FCM 토큰 회전이 모두</b>
     * {@code DEVICE_OWNERSHIP_CONFLICT} 로 막혀 푸시가 끊긴다(GROMO-1659 R1 P1).
     */
    @Test
    void legacyClientWithGenerationBearingTokenStillRegistersAndRotates() {
        assertThat(devices.register(USER, legacyBody("fcm-old", 0L), "legacy-first"))
                .containsKey("ownershipToken");
        assertThat(devices.register(USER, legacyBody("fcm-new", 0L), "legacy-rotate"))
                .containsKey("ownershipToken");

        assertThat(store.one("SELECT active,bootstrap_hash FROM device_tokens WHERE device_token='fcm-new'"))
                .containsEntry("active", true).containsEntry("bootstrap_hash", null);
        // 구 앱은 실행마다 같은 토큰을 다시 올린다 — 이관된 자기 행의 재등록도 거절되면 안 된다.
        assertThat(devices.register(USER, legacyBody("fcm-new", 0L), "legacy-again"))
                .containsKey("ownershipToken");
    }

    /**
     * 호환 창이 넓어져도 보장은 그대로다: 남의 활성 행 · 자기 tombstone · 세션에 묶인 현대 앱의 행은
     * 자격 없는 구 앱 모양 요청으로 가져오지 못하고, 낡은 세대는 여전히 유저 축에서 걸린다.
     */
    @Test
    void legacyShapedRequestNeitherStealsNorResurrectsAnything() {
        String owner = register(OTHER, "shared", "bootstrap", 1L, 0L, "other-modern");
        assertThatThrownBy(() -> devices.register(USER, legacyBody("shared", 0L), "steal-active"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");
        assertThat(store.one("SELECT user_id,ownership_token FROM device_tokens WHERE device_token='shared'"))
                .containsEntry("user_id", OTHER).containsEntry("ownership_token", UUID.fromString(owner));

        // 세션에 묶인 자기 행도 마찬가지다 — 구 앱 모양 요청이 소유권·CAS 를 우회하지 못한다.
        register(USER, "modern", "own-bootstrap", 1L, 0L, "own-modern");
        assertThatThrownBy(() -> devices.register(USER, legacyBody("modern", 0L), "bypass-cas"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");

        // 로그아웃·삭제가 남긴 tombstone 은 되살아나지 않는다.
        devices.delete(USER, "dead", null, 0L, "kill");
        assertThatThrownBy(() -> devices.register(USER, legacyBody("dead", 0L), "resurrect"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");

        // 세대 tombstone 도 그대로다 — 낡은 gen 은 창에 닿기 전에 걸린다.
        devices.generation(USER, 2L, false);
        assertThatThrownBy(() -> devices.register(USER, legacyBody("fcm-stale", 1L), "stale-gen"))
                .hasMessage("STALE_AUTH_GENERATION");
        // 세대를 실지 못하는 구 AT 는 세대가 오른 유저에게는 허용하지 않는다(정렬할 수 없다).
        // 이 판정은 창이 아니라 «맨 앞»에 있다 — 재생도 같은 자리에서 걸려야 하기 때문이다.
        assertThatThrownBy(() -> devices.register(USER, legacyBody("fcm-nogen", null), "no-gen"))
                .hasMessage("STALE_AUTH_GENERATION");
    }

    /** 탈퇴한 유저에게는 호환 창도 열리지 않는다. */
    @Test
    void withdrawnUserGetsNoLegacyWindow() {
        devices.generation(USER, 1L, true);
        assertThatThrownBy(() -> devices.register(USER, legacyBody("fcm", 1L), "withdrawn"))
                .hasMessage("STALE_AUTH_GENERATION");
    }

    /**
     * 구 앱의 <b>전체 수명 주기</b>. 자격을 저장하지 않는 앱이라 1회용 자격 축에 키를 만들 수 없지만,
     * Business 가 확인해 실어 준 <b>서명된 sid</b> 로 같은 일을 한다 — 등록 · 토큰 회전 · 로그아웃으로
     * 끊기 · 새 로그인으로 같은 FCM 토큰 되찾기(GROMO-1659 R1).
     */
    @Test
    void legacySessionRegistersRotatesAndIsCutByLogoutThenRestoredByNewLogin() {
        UUID first = UUID.randomUUID();
        assertThat(devices.register(USER, legacySessionBody("fcm-a", first, 1L), "legacy-new"))
                .containsKey("ownershipToken");
        assertThat(store.one("SELECT legacy_session_id,active FROM device_tokens WHERE device_token='fcm-a'"))
                .containsEntry("legacy_session_id", first).containsEntry("active", true);

        // 토큰 회전 — 구 앱엔 ownership 이 없으므로 sid 링크로 옛 행을 접는다(중복 푸시 방지).
        assertThat(devices.register(USER, legacySessionBody("fcm-b", first, 1L), "legacy-rotate"))
                .containsKey("ownershipToken");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='fcm-a'"))
                .containsEntry("active", false);
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='fcm-b'"))
                .containsEntry("active", true);

        // 로그아웃. 자격(nonce)이 없는 세션이라 종전에는 «아무 기기도 끊지 못했다».
        Map<String, Object> revoked = new LinkedHashMap<>();
        revoked.put("sessionId", first.toString());
        revoked.put("sessionEpoch", 2L);
        revoked.put("bootstrapNonceHash", null);
        devices.revokeSession(USER, revoked);
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='fcm-b'"))
                .containsEntry("active", false);

        // 폐기 뒤 도착한 지연 등록은 같은 sid 로 되돌아오지 못한다.
        assertThatThrownBy(() -> devices.register(USER, legacySessionBody("fcm-c", first, 2L), "late"))
                .hasMessage("SESSION_REVOKED");

        // 새 로그인은 새 sid 를 받는다 — 같은 FCM 토큰을 그대로 되찾을 수 있어야 한다.
        UUID second = UUID.randomUUID();
        assertThat(devices.register(USER, legacySessionBody("fcm-b", second, 3L), "relogin"))
                .containsKey("ownershipToken");
        assertThat(store.one("SELECT legacy_session_id,active FROM device_tokens WHERE device_token='fcm-b'"))
                .containsEntry("legacy_session_id", second).containsEntry("active", true);
    }

    /**
     * 삭제 tombstone 은 <b>새 FCM 토큰으로도</b> 되돌아오지 않는다. 이미 쓴 세션은 「자기 활성 행」이
     * 남아 있을 때만 회전을 이어 간다 — 아니면 삭제 한 번이 토큰 하나로 무효가 된다.
     */
    @Test
    void deletedLegacySessionCannotResurrectItselfWithAFreshToken() {
        UUID session = UUID.randomUUID();
        devices.register(USER, legacySessionBody("fcm-a", session, 1L), "legacy-new");
        devices.delete(USER, "fcm-a", null, 0L, "delete");

        assertThatThrownBy(() -> devices.register(USER, legacySessionBody("fcm-new", session, 1L), "revive"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");
        assertThatThrownBy(() -> devices.register(USER, legacySessionBody("fcm-a", session, 1L), "revive-same"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");

        // 복구는 새 로그인의 새 sid 로만 한다.
        assertThat(devices.register(USER, legacySessionBody("fcm-a", UUID.randomUUID(), 2L), "relogin"))
                .containsKey("ownershipToken");
    }

    /** 자격에 묶인 현대 앱의 행은 구 앱 세션으로 덮지 못한다 — 소유권 · CAS 의 우회로가 되면 안 된다. */
    @Test
    void legacySessionNeverOverwritesACredentialBoundRow() {
        register(USER, "modern", "bootstrap", 1L, 0L, "modern-reg");
        assertThatThrownBy(() -> devices.register(USER, legacySessionBody("modern", UUID.randomUUID(), 1L), "steal"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");
        assertThat(store.one("SELECT bootstrap_hash,active FROM device_tokens WHERE device_token='modern'"))
                .containsEntry("bootstrap_hash", Json.digest("bootstrap")).containsEntry("active", true);

        // 남의 세션 id 로도 통과하지 못한다 — fence 는 유저까지 함께 본다.
        UUID session = UUID.randomUUID();
        devices.register(USER, legacySessionBody("fcm-a", session, 1L), "mine");
        // sid 없는 구 AT가 새 세션 연결을 지우면 이후 로그아웃의 폐기가 이 기기에 닿지 못한다.
        assertThatThrownBy(() -> devices.register(USER, legacyBody("fcm-a", null), "downgrade"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");
        assertThat(store.one("SELECT legacy_session_id FROM device_tokens WHERE device_token='fcm-a'"))
                .containsEntry("legacy_session_id", session);
        assertThatThrownBy(() -> devices.register(OTHER, legacySessionBody("fcm-a", session, 1L), "borrowed"))
                .hasMessage("SESSION_REVOKED");
    }

    /**
     * <b>세대만</b> 달라진 재시도에 대한 <b>선택적 방어</b>다. 같은 키·같은 세션 축인데
     * {@code authGeneration} 만 {@code null} → {@code 0} 인 본문은 같은 의도로 본다.
     *
     * <p><b>이것은 실제 승격의 전선 테스트가 아니다.</b> 실제 구 AT → 새 AT 승격은 세대와 함께
     * {@code legacySessionId} 도 {@code null} → sid 로 바꾸므로 이 정규화만으로는 덮이지 않는다. 그 경로는
     * <b>앱에서</b> 닫는다 — 새 앱의 내구 큐가 «첫 전송 전에» 세션을 승격시켜 첫 요청부터 두 축을
     * 고정한다(구 앱은 {@code Idempotency-Key} 없이 호출하므로 같은 키 장부 자체가 없다).
     *
     * <p>그래도 이 정규화를 두는 이유는 세대 축의 계약을 못 박기 위해서다: null 을 현재 세대로
     * <b>채우지 않고</b>(그건 tombstone 우회다), 높은 세대는 여전히 다른 의도다.
     */
    @Test
    void generationOnlyDifferenceUnderTheSameKeyReplaysInsteadOfConflicting() {
        UUID session = UUID.randomUUID();
        Map<String, Object> before = legacySessionBody("fcm-a", session, 1L);
        before.put("authGeneration", null);
        String owner = devices.register(USER, before, "same-key").get("ownershipToken").toString();

        Map<String, Object> after = legacySessionBody("fcm-a", session, 1L);
        assertThat(devices.register(USER, after, "same-key").get("ownershipToken")).isEqualTo(owner);
        // 높은 세대는 섞이지 않는다.
        Map<String, Object> higher = legacySessionBody("fcm-a", session, 1L);
        higher.put("authGeneration", 1L);
        assertThatThrownBy(() -> devices.register(USER, higher, "same-key"))
                .hasMessage("IDEMPOTENCY_KEY_CONFLICT");
    }

    /** 세대가 오른 뒤 도착한 «gen 없는» 재시도는 재생도 받지 못한다 — 그 기기 행은 이미 죽어 있다. */
    @Test
    void replayOfAGenerationlessRetryIsRejectedOnceTheUserFenceMoved() {
        UUID session = UUID.randomUUID();
        Map<String, Object> body = legacySessionBody("fcm-a", session, 1L);
        body.put("authGeneration", null);
        devices.register(USER, body, "same-key");
        devices.generation(USER, 1L, false);

        assertThatThrownBy(() -> devices.register(USER, body, "same-key"))
                .hasMessage("STALE_AUTH_GENERATION");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='fcm-a'"))
                .containsEntry("active", false);
    }

    /** 구 앱 본문 — 자격 대신 Business 가 확인해 실어 준 서명된 sid 가 세션 축이다. */
    private Map<String, Object> legacySessionBody(String token, UUID session, long epoch) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deviceToken", token);
        body.put("legacySessionId", session.toString());
        body.put("sessionEpoch", epoch);
        body.put("authGeneration", 0L);
        return body;
    }

    /** 구 앱 본문 — 소유권 · 세션 자격 없이 {@code deviceToken} 만, AT 의 {@code gen} 만 실린다. */
    private Map<String, Object> legacyBody(String token, Long generation) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deviceToken", token);
        body.put("authGeneration", generation);
        return body;
    }

    private String register(UUID user, String token, String bootstrap, long epoch, long generation, String key) {
        return devices.register(user, body(token, bootstrap, epoch, generation, null), key)
                .get("ownershipToken").toString();
    }

    private Map<String, Object> body(String token, String bootstrap, long epoch, long generation, String ownership) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deviceToken", token);
        body.put("deviceBootstrap", bootstrap);
        body.put("sessionEpoch", epoch);
        body.put("authGeneration", generation);
        body.put("ownershipToken", ownership);
        return body;
    }
}

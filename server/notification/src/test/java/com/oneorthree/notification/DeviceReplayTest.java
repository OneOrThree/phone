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
        store.update("TRUNCATE commands,device_tokens,session_fences,user_fences CASCADE");
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

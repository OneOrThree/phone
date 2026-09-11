package com.oneorthree.phone.invitelink.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 링크 자격 검증 (A22 ⓚ).
 *
 * <p>서명 대상이 <b>원본 JSON 이 아니라 base64url 문자열</b>이라는 것이 이 계약의 핵심이고
 * ({@code link/src/lib/auth.ts:62-68}), 여기서 발급 측과 같은 방식으로 만들어 확인한다.
 */
class LinkCapabilityVerifierTest {

    private static final String KEY = "test-link-capability-key";
    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");

    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final LinkCapabilityVerifier verifier = new LinkCapabilityVerifier(KEY, false, clock);

    /** 발급 측과 «같은 방식»으로 만든 자격 — payload 를 base64url 한 뒤 그 문자열에 서명한다. */
    private static String sign(String key, String json) {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(json.getBytes(StandardCharsets.UTF_8));
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String signature = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
            return payload + "." + signature;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String payloadJson(UUID groupId, UUID inviterId, long epoch, long exp) {
        // membershipEpoch 는 «문자열»이다 — 발급 측이 link_version 을 그대로 싣는다.
        return "{\"slug\":\"abc123\",\"groupId\":\"" + groupId + "\",\"inviterId\":\"" + inviterId
                + "\",\"membershipEpoch\":\"" + epoch + "\",\"exp\":" + exp + "}";
    }

    @Test
    @DisplayName("정상 자격은 내용까지 그대로 꺼낸다 — membershipEpoch 는 문자열로 실려 온다")
    void verifiesValidCapability() {
        UUID groupId = UUID.randomUUID();
        UUID inviterId = UUID.randomUUID();
        String capability = sign(KEY, payloadJson(groupId, inviterId, 3L, NOW.getEpochSecond() + 300));

        Optional<LinkCapability> result = verifier.verify(capability);

        assertThat(result).isPresent();
        assertThat(result.get().slug()).isEqualTo("abc123");
        assertThat(result.get().groupId()).isEqualTo(groupId);
        assertThat(result.get().inviterId()).isEqualTo(inviterId);
        assertThat(result.get().membershipEpoch()).isEqualTo(3L);
    }

    @Test
    @DisplayName("다른 키로 서명한 자격은 거절한다")
    void rejectsForeignSignature() {
        String capability = sign("another-key",
                payloadJson(UUID.randomUUID(), UUID.randomUUID(), 1L, NOW.getEpochSecond() + 300));

        assertThat(verifier.verify(capability)).isEmpty();
    }

    @Test
    @DisplayName("payload 를 바꿔치면 거절한다 — 서명 대상이 base64url «문자열» 이라 함께 깨진다")
    void rejectsTamperedPayload() {
        UUID groupId = UUID.randomUUID();
        UUID inviterId = UUID.randomUUID();
        String capability = sign(KEY, payloadJson(groupId, inviterId, 1L, NOW.getEpochSecond() + 300));
        String tampered = Base64.getUrlEncoder().withoutPadding().encodeToString(
                payloadJson(groupId, inviterId, 99L, NOW.getEpochSecond() + 300)
                        .getBytes(StandardCharsets.UTF_8))
                + capability.substring(capability.indexOf('.'));

        assertThat(verifier.verify(tampered)).isEmpty();
    }

    @Test
    @DisplayName("만료된 자격은 거절한다 — exp 는 «초» 단위다")
    void rejectsExpiredCapability() {
        String capability = sign(KEY,
                payloadJson(UUID.randomUUID(), UUID.randomUUID(), 1L, NOW.getEpochSecond()));

        assertThat(verifier.verify(capability)).isEmpty();
    }

    @Test
    @DisplayName("형식이 깨진 값은 예외가 아니라 «거절»이다 — 호출부의 결론이 하나다")
    void rejectsMalformedValues() {
        assertThat(verifier.verify(null)).isEmpty();
        assertThat(verifier.verify("")).isEmpty();
        assertThat(verifier.verify("nodot")).isEmpty();
        assertThat(verifier.verify(".onlysignature")).isEmpty();
        assertThat(verifier.verify("payload.")).isEmpty();
        assertThat(verifier.verify("a.b.c")).isEmpty();
        assertThat(verifier.verify("!!!.!!!")).isEmpty();
    }

    @Test
    @DisplayName("키가 없으면 «전량 거절» 이다 — 「키가 없으니 통과」는 서명 검사를 통째로 여는 것이다")
    void missingKeyRejectsEverything() {
        LinkCapabilityVerifier keyless = new LinkCapabilityVerifier("", false, clock);
        String capability = sign(KEY,
                payloadJson(UUID.randomUUID(), UUID.randomUUID(), 1L, NOW.getEpochSecond() + 300));

        assertThat(keyless.verify(capability)).isEmpty();
    }

    @Test
    @DisplayName("내부 표면이 켜졌는데 키가 없으면 부팅에서 막는다 — 첫 claim 때 드러나면 이미 늦다")
    void enabledInternalSurfaceRequiresKey() {
        assertThatThrownBy(() -> new LinkCapabilityVerifier(" ", true, clock))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("link.capability-key");
    }
}

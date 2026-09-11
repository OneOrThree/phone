package com.oneorthree.phone.invitelink.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

/**
 * 링크 서버가 서명한 가입 자격의 <b>검증</b> (A22 ⓚ).
 *
 * <h2>형식</h2>
 * {@code base64url(JSON payload) + "." + base64url(HMAC-SHA256(그 base64url 문자열))} 이다.
 * 서명 대상이 원본 JSON 이 아니라 <b>인코딩된 문자열</b>이라는 점이 중요하다 — 발급 측
 * ({@code link/src/lib/auth.ts:62-68})이 그렇게 만든다. 여기서 JSON 을 다시 직렬화해 서명하면
 * 공백·키 순서 하나에 전부 불일치가 된다.
 *
 * <h2>검증만 하고 발급하지 않는다</h2>
 * 발급은 링크 서버의 몫이다. Data 에 발급 경로를 두면 자격을 만드는 주체가 둘이 되어, 「누가 발급한
 * 자격인가」를 아무도 답할 수 없게 된다. 키({@code LINK_CAPABILITY_KEY})는 양쪽이 보유한다.
 *
 * <h2>실패를 구분하지 않는다</h2>
 * 서명 불일치·형식 파손·만료는 전부 {@code Optional.empty()} 다. 호출부의 결론이 하나(거절)라
 * 타입으로 나누면 catch 를 복붙하게 되고, 그중 하나가 빠지면 그 경로만 500 이 된다. 어느 쪽이었는지는
 * 로그에만 남긴다 — 응답으로 구분해 주면 자격 위조 시도에 힌트가 된다.
 */
@Slf4j
@Component
public class LinkCapabilityVerifier {

    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final byte[] key;
    private final Clock clock;

    /**
     * @param key                 {@code LINK_CAPABILITY_KEY} — 링크 서버와 <b>같은 값</b>이어야 한다
     * @param internalApiEnabled  내부 표면이 켜져 있는가. 켜져 있는데 키가 없으면 <b>부팅에서</b>
     *                            막는다 — 그 조합은 「자격 검증이 전량 거절되는 채로 열린 confirm 경로」이고,
     *                            그 사실은 첫 claim 이 들어온 뒤에야 드러난다. 꺼져 있으면 이 경로를
     *                            부를 수 있는 호출자가 없으므로 키를 요구하지 않는다(로컬·CI 기동 보존)
     * @param clock               만료 판정 시계
     */
    public LinkCapabilityVerifier(
            @Value("${link.capability-key:}") String key,
            @Value("${internal.api.enabled:false}") boolean internalApiEnabled,
            Clock clock) {
        boolean usable = isResolved(key);
        if (!usable && internalApiEnabled) {
            throw new IllegalStateException(
                    "internal.api.enabled=true 인데 link.capability-key 가 비었거나 미해결 placeholder 입니다 — "
                            + "링크 자격 검증 키가 필요합니다.");
        }
        if (!usable) {
            log.warn("link.capability-key 미설정 — 링크 자격 검증은 전량 거절됩니다(내부 표면이 꺼져 있어 호출자는 없다).");
        }
        this.key = usable ? key.getBytes(StandardCharsets.UTF_8) : new byte[0];
        this.clock = clock;
    }

    /**
     * 값이 <b>실제로 채워졌는지</b> — 빈 값과 <b>미해결 placeholder</b> 둘 다 「없음」이다.
     *
     * <p>후자가 실물에서 확인된 함정이다: 환경변수가 없으면 Spring 은 {@code ${LINK_CAPABILITY_KEY}}
     * 라는 <b>문자열 자체</b>를 값으로 넣는다. 그대로 쓰면 링크 서버와 다른 키로 HMAC 을 만들어
     * 모든 claim 이 조용히 거절되고, 그 원인은 서명 불일치로만 보인다.
     */
    private static boolean isResolved(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        String trimmed = value.trim();
        return !(trimmed.startsWith("${") && trimmed.endsWith("}"));
    }

    /**
     * 자격을 검증하고 내용을 꺼낸다.
     *
     * @param capability {@code payload.signature} 문자열
     * @return 서명·형식·만료를 모두 통과한 내용. 그 밖에는 전부 {@code Optional.empty()}
     */
    public Optional<LinkCapability> verify(String capability) {
        if (key.length == 0) {
            // 키가 없으면 «검증할 수 없다» = 거절이다. 「키가 없으니 통과」는 서명 검사를 통째로 여는 것이다.
            return Optional.empty();
        }
        if (capability == null || capability.isBlank()) {
            return Optional.empty();
        }
        int dot = capability.indexOf('.');
        if (dot <= 0 || dot == capability.length() - 1 || capability.indexOf('.', dot + 1) >= 0) {
            log.debug("링크 자격 형식 불일치");
            return Optional.empty();
        }
        String encodedPayload = capability.substring(0, dot);
        String signature = capability.substring(dot + 1);

        if (!signatureMatches(encodedPayload, signature)) {
            log.debug("링크 자격 서명 불일치");
            return Optional.empty();
        }
        LinkCapability parsed = parse(encodedPayload);
        if (parsed == null) {
            return Optional.empty();
        }
        if (parsed.expiresAtEpochSecond() <= clock.instant().getEpochSecond()) {
            log.debug("링크 자격 만료 — slug={}", parsed.slug());
            return Optional.empty();
        }
        return Optional.of(parsed);
    }

    /** 상수 시간 비교 — {@code equals} 의 조기 종료는 서명 한 바이트씩을 타이밍으로 흘린다. */
    private boolean signatureMatches(String encodedPayload, String signature) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(key, HMAC_ALGORITHM));
            byte[] expected = mac.doFinal(encodedPayload.getBytes(StandardCharsets.UTF_8));
            byte[] presented = Base64.getUrlDecoder().decode(signature);
            return MessageDigest.isEqual(expected, presented);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            return false;
        }
    }

    private LinkCapability parse(String encodedPayload) {
        try {
            JsonNode node = MAPPER.readTree(Base64.getUrlDecoder().decode(encodedPayload));
            // membershipEpoch 는 «문자열»로 온다(발급 측이 link_version 을 그대로 싣는다).
            // asLong() 은 문자열도 읽지만, 숫자가 아니면 0 을 주므로 그 값이 실제 세대와 같아질 수
            // 있는지 확인해야 한다 — 세대는 1부터 시작하므로 0 은 어떤 멤버십과도 일치하지 않는다.
            return new LinkCapability(
                    node.path("slug").asText(null),
                    UUID.fromString(node.path("groupId").asText()),
                    UUID.fromString(node.path("inviterId").asText()),
                    node.path("membershipEpoch").asLong(0L),
                    node.path("exp").asLong(0L));
        } catch (RuntimeException | java.io.IOException e) {
            log.debug("링크 자격 payload 파손 — {}", e.getClass().getSimpleName());
            return null;
        }
    }
}

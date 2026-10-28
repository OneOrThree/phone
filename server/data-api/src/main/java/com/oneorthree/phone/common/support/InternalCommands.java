package com.oneorthree.phone.common.support;

import com.oneorthree.phone.outbox.dto.IdempotencyRequest;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

/**
 * 내구 명령의 <b>멱등 키·지문</b> 조립 (A22 ㉼ · ㊞).
 *
 * <h2>키가 없으면 만들어 쓴다 — 단, 본문에서 도출하지 않는다</h2>
 * 키의 소유자는 <b>앱</b>이다. 그런데 현 앱은 {@code Idempotency-Key} 를 보내지 않으므로 그 기간에는
 * <b>매 호출 새 키</b>를 만든다 — 그러면 막히는 것은 「Business 내부 재시도」뿐이고 앱 재시도는
 * 현행과 같은 수준으로 남는다.
 *
 * <p><b>요청 본문 해시를 키로 쓰면 안 된다</b>(㊞). 같은 설정으로 되돌리는 정상 설정 변경이 과거
 * 응답으로 접혀 <b>아무것도 바뀌지 않는다</b>. 본문 해시는 「같은 키로 다른 본문이 왔는가」를 보는
 * 지문일 뿐이다.
 */
public final class InternalCommands {

    private InternalCommands() {
    }

    /**
     * 멱등 요청을 만든다.
     *
     * @param headerKey   {@code Idempotency-Key} 헤더. 없으면 이번 호출용 키를 새로 만든다
     * @param userId      명령 주체
     * @param commandType 명령 종류 — 키가 어느 명령의 것인지 기록에 남는다
     * @param bodyParts   본문 지문의 재료. {@code null} 은 빈 문자열로 접는다
     * @return 저장·재생에 쓸 멱등 요청
     */
    public static IdempotencyRequest idempotency(
            String headerKey, UUID userId, String commandType, Object... bodyParts) {
        String key = headerKey == null || headerKey.isBlank()
                ? commandType + ":" + UUID.randomUUID()
                : headerKey.trim();
        return new IdempotencyRequest(key, userId, commandType, fingerprint(bodyParts));
    }

    /**
     * 본문 지문 — SHA-256 hex.
     *
     * <p>각 조각 앞에 <b>길이</b>를 붙여 잇는다. 그냥 이으면 {@code ("ab","c")} 와 {@code ("a","bc")}
     * 가 같은 지문이 되어, 서로 다른 본문이 「같은 본문」으로 통과한다.
     *
     * @param parts 지문 재료
     * @return 64자 hex
     */
    public static String fingerprint(Object... parts) {
        StringBuilder joined = new StringBuilder();
        for (Object part : parts) {
            String text = part == null ? "" : part.toString();
            joined.append(text.length()).append(':').append(text).append(';');
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(joined.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 은 JDK 필수 알고리즘이다 — 여기 오면 런타임이 깨진 것이라 숨기지 않는다.
            throw new IllegalStateException("SHA-256 미지원", e);
        }
    }
}

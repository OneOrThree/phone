package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;

import java.util.Map;
import java.util.Set;

/**
 * 2.0 표면의 게스트 세션 발급 요청 (GROMO-2036).
 *
 * @param deviceDigest Business 가 자기 비밀로 계산한 기기 식별자의 keyed HMAC-SHA256 hex(64자).
 *                     <b>원 기기 식별자는 Data 에 오지 않는다</b>(계정 LLD §3 「앱이 제출한 digest 를
 *                     자격으로 수락하지 않는다」 — 계산 주체가 서버라는 것이 그 규칙의 요지다)
 * @param clientIp     <b>Business 의 {@code ClientIpResolver} 가 신뢰한 프록시에서 판정한</b> 호출자 주소.
 *                     게스트 생성 레이트리밋의 축이라 이 값 없이는 인증 없는 계정 생성이 무제한이 된다.
 *                     내부 호출의 소스 IP 를 쓰면 모든 게스트가 Business 컨테이너 한 주소로 뭉쳐
 *                     한도가 «전원 차단» 으로 동작한다. 앱이 보낸 헤더가 아니라 Business 의 판정값이다
 */
public record GuestSessionRequest(String deviceDigest, String clientIp) {

    private static final int DIGEST_LENGTH = 64;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static GuestSessionRequest fromJson(Map<String, Object> fields) {
        if (fields == null || !Set.of("deviceDigest", "clientIp").containsAll(fields.keySet())
                || !(fields.get("deviceDigest") instanceof String digest)
                || !(fields.get("clientIp") instanceof String ip)
                || digest.length() != DIGEST_LENGTH || !digest.chars().allMatch(GuestSessionRequest::isLowerHex)
                || ip.isBlank()) {
            throw new IllegalArgumentException("게스트 발급 요청 형식이 올바르지 않습니다.");
        }
        return new GuestSessionRequest(digest, ip);
    }

    private static boolean isLowerHex(int c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
    }
}

package com.oneorthree.business.auth;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Enumeration;
import java.util.UUID;

/**
 * 게스트 시작 자격 — {@code X-Device-Id} 와 <b>선택</b> AT (GROMO-2036).
 *
 * <h2>{@code X-Device-Id} 는 «멱등 키» 다</h2>
 * 게스트 발급은 호출 한 번마다 {@code users} 행이 하나 생긴다. 201 이 유실된 재시도가 계정을 둘
 * 만들지 않도록 앱이 설치마다 하나 만들어 보관하는 값이다 — {@link LoginAttemptCredentials} 의
 * {@code X-Login-Attempt-Id} 와 같은 자리이고, 같은 이유로 <b>형식이 엄격</b>하다: 하이픈 포함 36자
 * UUID 만 받고 왕복 검사까지 한다. {@code UUID.fromString} 은 {@code "1-2-3-4-5"} 같은 짧은 문자열도
 * 받아들여, 길이·왕복 검사를 빼면 같은 기기가 두 표기로 갈려 계정이 둘 생긴다.
 *
 * <p>버전 비트는 보지 않는다 — 정책 A19 의 「v4/v7 은 생성 «권고»이며 다른 버전이라는 이유로 거부하지
 * 않는다」가 여기에도 그대로 적용된다.
 *
 * <p><b>이 값은 보안 경계가 아니다.</b> 클라이언트 소유라 바꿔 보내면 새 버킷이 되므로 대량 생성을
 * 막지 못한다 — 그 축은 Data 의 {@code GuestLoginRateLimiter}(IP·전역)가 맡는다. 반대로 <b>짧은
 * 복구 창 안에서는 이 값이 그 게스트 계정을 여는 자격</b>이므로 앱은 기기 밖으로 내보내지 않는다.
 *
 * <h2>AT 가 «선택» 인 이유</h2>
 * {@link LoginAttemptCredentials} 와 같다 — 게스트 시작에는 보통 AT 가 없지만, 보냈다면 반드시
 * 유효해야 한다. 잘못된 AT 를 익명 시작으로 조용히 강등하지 않는다(계정 LLD §2.1).
 */
public record GuestDeviceCredentials(UUID deviceId, String accessToken) {

    public static final String PATH = "/auth/sessions/guest";
    public static final String DEVICE_HEADER = "X-Device-Id";
    private static final String BEARER = "Bearer ";
    private static final int UUID_LENGTH = 36;
    private static final int MAX_CREDENTIAL_LENGTH = 8192;

    /** 필터 예외와 컨트롤러가 공유하는 정확 일치. {@code getRequestURI()} 는 디코딩 전 원문이다. */
    public static boolean matches(HttpServletRequest request) {
        return "POST".equals(request.getMethod()) && PATH.equals(request.getRequestURI());
    }

    public static GuestDeviceCredentials from(HttpServletRequest request) {
        String rawDeviceId = single(request, DEVICE_HEADER, ApiErrorCode.INVALID_REQUEST, DEVICE_HEADER);
        if (rawDeviceId == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, DEVICE_HEADER);
        }
        UUID deviceId = canonicalUuid(rawDeviceId);

        String authorization = single(request, "Authorization", ApiErrorCode.UNAUTHORIZED, null);
        String access = null;
        if (authorization != null) {
            if (!authorization.startsWith(BEARER) || authorization.length() == BEARER.length()) {
                throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
            }
            access = authorization.substring(BEARER.length());
        }
        return new GuestDeviceCredentials(deviceId, access);
    }

    private static UUID canonicalUuid(String value) {
        if (value.length() != UUID_LENGTH) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, DEVICE_HEADER);
        }
        try {
            UUID parsed = UUID.fromString(value);
            if (!parsed.toString().equalsIgnoreCase(value)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, DEVICE_HEADER);
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, DEVICE_HEADER);
        }
    }

    /** 헤더가 <b>정확히 하나</b>여야 한다 — 둘이면 경유 경로마다 다른 기기로 보여 멱등이 무너진다. */
    private static String single(HttpServletRequest request, String header, ApiErrorCode error, String field) {
        Enumeration<String> values = request.getHeaders(header);
        if (values == null || !values.hasMoreElements()) {
            return null;
        }
        String value = values.nextElement();
        if (values.hasMoreElements() || value == null || value.isBlank()
                || value.length() > MAX_CREDENTIAL_LENGTH || !value.equals(value.strip())
                || value.contains(",")) {
            throw new PublicApiException(error, field);
        }
        return value;
    }

    /** 기기 식별자·AT 가 로그·오류 덤프로 새지 않게 한다 — 둘 다 자격이다. */
    @Override
    public String toString() {
        return "GuestDeviceCredentials[redacted]";
    }
}

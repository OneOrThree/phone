package com.oneorthree.business.common.validation;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;

import java.util.UUID;

/**
 * 공개 경로·쿼리·요청 본문 필드에 실려 오는 UUID 문자열의 엄격 파서.
 *
 * <p>{@code UUID.fromString} 은 {@code "1-1-1-1-1"} 같은 축약형도 받아들이므로, 길이(36)와
 * 정규 표기 왕복 여부를 함께 검사해 정규 표기(8-4-4-4-12)만 통과시킨다. 축약형을 패딩된 다른
 * UUID 로 상류에 넘기면 형식 오류가 400 이 아니라 「그 섬의 주민이 아니다」 403 으로 둔갑해, 앱이
 * 고칠 수 없는 입력을 권한 문제로 읽게 된다. {@code value} 가
 * {@code null} 이면 {@link UUID#fromString} 이 던지는 {@link NullPointerException} 을 그대로
 * 전파한다 — {@link IllegalArgumentException} 만 {@link PublicApiException} 으로 감싼다.
 */
public final class PublicIds {

    private PublicIds() {
    }

    /** {@link ApiErrorCode#INVALID_PARAMETER} 로 거절하는 기본형. */
    public static UUID uuid(String value, String field) {
        return uuid(value, field, ApiErrorCode.INVALID_PARAMETER);
    }

    /** 호출부가 직접 오류 코드를 고르는 형. */
    public static UUID uuid(String value, String field, ApiErrorCode code) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(code, field);
        }
    }
}

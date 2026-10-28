package com.oneorthree.business.common.request;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.api.PublicCurrentState;
import tools.jackson.databind.JsonNode;

/** 버전 입력의 공통 범위. 실제 원자 비교는 Data의 해당 자원 잠금 안에서 수행한다. */
public final class ResourceVersions {

    public static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    private ResourceVersions() {
    }

    public static long required(Long value, String field) {
        if (value == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        if (value < 0 || value > MAX_SAFE_INTEGER) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
        return value;
    }

    /** JSON 정수 타입을 변환 전에 확인한다. 1.5를 1로 절삭하는 기본 강제변환을 사용하지 않는다. */
    public static long fromJson(JsonNode value, String field) {
        if (value == null || !value.isIntegralNumber()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        if (!value.canConvertToLong()) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
        return required(value.longValue(), field);
    }

    /** 인가된 공개 DTO만 받을 수 있다. 원자 명령의 성공 receipt 재생 뒤에 버전을 다시 비교하지 않는다. */
    public static void verify(long expected, String field, PublicCurrentState current) {
        required(expected, field);
        if (expected != current.version()) {
            throw new PublicApiException(ApiErrorCode.VERSION_CONFLICT, field, current);
        }
    }
}

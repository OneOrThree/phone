package com.oneorthree.business.common.request;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;

import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.UUID;

/** 검증된 사용자와 정규 필터. 값은 토큰에 노출하지 않고 scope 지문으로만 사용한다. */
public record CursorScope(UUID userId, String resource, Map<String, String> filters, String sort, int limit) {

    public CursorScope {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(resource, "resource");
        if (resource.isBlank() || sort == null || !sort.matches("[a-z][a-z0-9_-]{0,63}")) {
            throw new IllegalArgumentException("정규 자원과 정렬 이름이 필요합니다.");
        }
        if (limit < 1 || limit > 100) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "limit");
        }
        filters = Map.copyOf(filters);
    }

    String digest() {
        StringBuilder value = new StringBuilder();
        append(value, userId.toString());
        append(value, resource);
        append(value, sort);
        append(value, Integer.toString(limit));
        new TreeMap<>(filters).forEach((key, item) -> {
            append(value, key);
            append(value, item);
        });
        return SemanticFingerprint.digest(value.toString());
    }

    private static void append(StringBuilder builder, String value) {
        builder.append(value.length()).append(':').append(value);
    }
}

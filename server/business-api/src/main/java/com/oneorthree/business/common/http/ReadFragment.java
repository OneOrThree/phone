package com.oneorthree.business.common.http;

import org.springframework.core.ParameterizedTypeReference;

import java.util.Objects;
import java.util.Set;
import java.util.function.Function;

/** 화면의 독립 읽기 조각. 선택 실패의 허용 범위를 호출부가 명시한다. */
public record ReadFragment<T>(String name, boolean required, ParameterizedTypeReference<T> responseType,
        Set<TransientFailure> allowedFailures, Function<UpstreamRequestContext, T> read) {

    public ReadFragment {
        if (name == null || !name.matches("[A-Za-z][A-Za-z0-9_]{0,63}")) {
            throw new IllegalArgumentException("조각 이름이 올바르지 않습니다.");
        }
        Objects.requireNonNull(responseType, "responseType");
        Objects.requireNonNull(read, "read");
        allowedFailures = Set.copyOf(allowedFailures);
        if (required && !allowedFailures.isEmpty()) {
            throw new IllegalArgumentException("필수 조각의 실패를 숨길 수 없습니다.");
        }
    }

    public enum TransientFailure {
        UNAVAILABLE,
        TIMEOUT
    }
}

package com.oneorthree.business.common.request;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.usecase.RequestIdempotencyKeys;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Collections;
import java.util.UUID;
import java.util.regex.Pattern;

/** 신규 명령에만 쓰는 앱 소유 키. 로그인·메시지·legacy 선택 키 경로에는 일괄 적용하지 않는다. */
public final class CommandKeys {

    private static final Pattern UUID_TEXT = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private CommandKeys() {
    }

    public static UUID required(HttpServletRequest request) {
        var values = Collections.list(request.getHeaders("Idempotency-Key"));
        if (values.size() != 1) {
            throw invalid();
        }
        return required(values.get(0));
    }

    public static UUID required(String value) {
        if (value == null || !UUID_TEXT.matcher(value).matches()) {
            throw invalid();
        }
        return UUID.fromString(value);
    }

    /** 내부 단계 이름 규약을 새로 만들지 않고 기존 구현을 사용한다. */
    public static RequestIdempotencyKeys forSteps(UUID key) {
        return RequestIdempotencyKeys.from(key.toString());
    }

    private static PublicApiException invalid() {
        return new PublicApiException(ApiErrorCode.INVALID_IDEMPOTENCY_KEY, "Idempotency-Key");
    }
}

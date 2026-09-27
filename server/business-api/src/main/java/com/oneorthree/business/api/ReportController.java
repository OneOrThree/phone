package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.ReportUseCase;
import com.oneorthree.business.usecase.ReportUseCase.ReportReason;
import com.oneorthree.business.usecase.ReportUseCase.ReportReceipt;
import com.oneorthree.business.usecase.ReportUseCase.ReportTargetType;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/** 앱 내 신고를 서버 원문 검증 뒤 운영 메일함에 접수하는 공개 표면. */
@RestController
@RequiredArgsConstructor
public class ReportController {

    private static final Pattern EMAIL = Pattern.compile(
            "^[A-Za-z0-9.!#$%&'*+=?^_{}|~-]+@"
                    + "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                    + "(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$");

    private final ReportUseCase reports;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @PostMapping(value = "/reports", consumes = "application/json")
    public ResponseEntity<ReportReceipt> report(@RequestBody JsonNode body, HttpServletRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        if (body == null || !body.isObject() || body.size() != 6) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        UUID requestId = idempotencyKey == null
                ? invalidIdempotencyKey()
                : PublicIds.uuid(idempotencyKey, "Idempotency-Key", ApiErrorCode.INVALID_IDEMPOTENCY_KEY);
        ReportTargetType targetType = enumValue(ReportTargetType.class, string(body, "targetType"), "targetType");
        UUID targetId = PublicIds.uuid(string(body, "targetId"), "targetId");
        ReportReason reason = enumValue(ReportReason.class, string(body, "reason"), "reason");
        String description = nullableString(body, "description", 1000);
        String replyEmail = nullableString(body, "replyEmail", 254);
        boolean blockUser = bool(body, "blockUser");
        if (reason == ReportReason.OTHER && (description == null || description.isBlank())) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "description");
        }
        if (replyEmail != null && !EMAIL.matcher(replyEmail).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "replyEmail");
        }
        AccessTokenClaims claims = sessions.requireSession(request);
        ReportReceipt receipt = reports.report(claims, requestId, targetType, targetId, reason,
                description == null ? null : description.strip(), replyEmail, blockUser, properties.deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(receipt);
    }

    private static String string(JsonNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || !value.isString() || value.stringValue().isBlank()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        return value.stringValue();
    }

    private static String nullableString(JsonNode body, String field, int max) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isString() || value.stringValue().length() > max) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
        return value.stringValue().isBlank() ? null : value.stringValue().strip();
    }

    private static boolean bool(JsonNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || !value.isBoolean()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        return value.booleanValue();
    }

    private static <T extends Enum<T>> T enumValue(Class<T> type, String value, String field) {
        try {
            return Enum.valueOf(type, value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
    }

    private static UUID invalidIdempotencyKey() {
        throw new PublicApiException(ApiErrorCode.INVALID_IDEMPOTENCY_KEY, "Idempotency-Key");
    }
}

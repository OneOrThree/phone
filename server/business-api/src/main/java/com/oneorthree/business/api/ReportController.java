package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.ReportReceipt;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.DataReportClient;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Set;
import java.util.UUID;

/** 신고자 ID는 AT에서만 정한다. 일반 앱에는 접수 외 운영 API를 제공하지 않는다. */
@RestController
@RequiredArgsConstructor
public class ReportController {
    private final DataReportClient reports;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @PostMapping(value = "/reports", consumes = "application/json")
    public ReportReceipt submit(@RequestBody JsonNode body, HttpServletRequest request) {
        var caller = sessions.requireSession(request);
        if (body == null || !body.isObject() || body.properties().stream().anyMatch(entry -> !Set.of(
                "requestId", "targetType", "targetId", "targetUserId", "reason", "details", "submittedText")
                .contains(entry.getKey()))) {
            throw invalid();
        }
        var command = new DataReportClient.Command(id(body, "requestId", true), text(body, "targetType", 32, true),
                id(body, "targetId", false), id(body, "targetUserId", false), text(body, "reason", 32, true),
                text(body, "details", 2000, true), text(body, "submittedText", 5000, false));
        try {
            var receipt = reports.submit(caller.userId(), caller.sessionId(), caller.authGeneration(), command,
                    properties.deadline());
            return new ReportReceipt(receipt.reportId(), receipt.receivedAt());
        } catch (UpstreamDomainException e) {
            if (e.getStatus() == 403 && "SESSION_NOT_ACTIVE".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
            }
            if ("REPORT_INVALID".equals(e.getCode()) && e.getStatus() == 400) {
                throw invalid();
            }
            if ("REPORT_KEY_REUSED".equals(e.getCode()) && e.getStatus() == 409) {
                throw new PublicApiException(ApiErrorCode.IDEMPOTENCY_KEY_REUSED, null);
            }
            throw e;
        }
    }

    private static UUID id(JsonNode body, String name, boolean required) {
        String value = text(body, name, 36, required);
        return value == null ? null : PublicIds.uuid(value, name);
    }

    private static String text(JsonNode body, String name, int max, boolean required) {
        JsonNode value = body.get(name);
        if (value == null || value.isNull()) {
            if (!required) {
                return null;
            }
            throw invalid();
        }
        if (!value.isString() || value.stringValue().length() > max || value.stringValue().indexOf('\0') >= 0
                || (required && value.stringValue().isBlank())) {
            throw invalid();
        }
        return value.stringValue();
    }

    private static PublicApiException invalid() {
        return new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
    }
}

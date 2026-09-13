package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.AccountSettingsUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/** 신규 공개 2종. 공통 response advice가 성공 data 봉투를 한 번 적용한다. */
@RestController
@RequestMapping("/me/settings")
@RequiredArgsConstructor
public class AccountSettingsController {

    private final AccountSettingsUseCase settings;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping
    public AccountSettingsUseCase.Result read(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return settings.read(claims, deadline());
    }

    @PatchMapping(consumes = "application/json")
    public AccountSettingsUseCase.Result patch(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.size() != 1
                || !body.has("notifications") || !body.get("notifications").isBoolean()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "notifications");
        }
        return settings.patch(claims, body.get("notifications").booleanValue(), key, deadline());
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}

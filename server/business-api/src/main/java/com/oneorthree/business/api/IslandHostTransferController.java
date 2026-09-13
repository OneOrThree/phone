package com.oneorthree.business.api;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandHostTransferUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/** 위임 명령의 공개 경계. 실제 활성화·권한·원자 변경은 Data가 판정한다. */
@RestController
@RequiredArgsConstructor
public class IslandHostTransferController {

    private final IslandHostTransferUseCase transfers;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @PostMapping(value = "/islands/{islandId}/host-transfer", consumes = "application/json")
    public IslandHostTransferUseCase.Result transfer(@PathVariable String islandId,
            @RequestBody JsonNode body, HttpServletRequest request) {
        var claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        UUID island = id(islandId, "islandId");
        String exactPath = request.getContextPath() + "/islands/" + islandId + "/host-transfer";
        if (!exactPath.equals(request.getRequestURI()) || request.getQueryString() != null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        if (body == null || !body.isObject() || body.size() != 1
                || !body.has("targetUserId") || !body.get("targetUserId").isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "targetUserId");
        }
        UUID target = id(body.get("targetUserId").stringValue(), "targetUserId");
        return transfers.transfer(claims, island, target, key,
                Deadline.startingNow(properties.getComposition().getDeadline()));
    }

    private static UUID id(String value, String field) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
    }
}

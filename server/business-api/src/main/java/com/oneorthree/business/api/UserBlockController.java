package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.UserBlockUseCase.BlockedUserView;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import com.oneorthree.business.usecase.UserBlockUseCase;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.UUID;

/** 사용자 차단 공개 표면. 응답 봉투·AT 주체는 다른 공개 BFF 엔드포인트와 같은 규칙을 따른다. */
@RestController
@RequiredArgsConstructor
public class UserBlockController {

    private final UserBlockUseCase blocks;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @PostMapping(value = "/blocks", consumes = "application/json")
    public ResponseEntity<Void> block(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        blocks.block(claims, blockedUserId(body), properties.deadline());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/blocks/{blockedUserId}")
    public ResponseEntity<Void> unblock(@PathVariable String blockedUserId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        blocks.unblock(claims, PublicIds.uuid(blockedUserId, "blockedUserId"), properties.deadline());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/blocks")
    public List<BlockedUserView> blocks(HttpServletRequest request) {
        return blocks.blocks(sessions.requireSession(request), properties.deadline());
    }

    private static UUID blockedUserId(JsonNode body) {
        if (body == null || !body.isObject() || body.size() != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode value = body.get("blockedUserId");
        if (value == null || !value.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "blockedUserId");
        }
        return PublicIds.uuid(value.stringValue(), "blockedUserId");
    }
}

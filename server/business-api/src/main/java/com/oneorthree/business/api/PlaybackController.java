package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.PlaybackState;
import com.oneorthree.business.usecase.PlaybackUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 공용 음악(방송기)의 공개 표면 (GROMO-1779, island-playback LLD §2) — {@code GET·PATCH
 * /islands/{islandId}/playback}. {@code /islands/**} 는 {@code PublicApiRoutes.ROOTS} 에 있어 봉투가
 * 자동으로 씌워진다. 주체는 strict 세션에서만 오고, 주민·방송기·소유·버전 판정은 Data TX 가 한다.
 *
 * <p>PATCH 는 {@code expectedVersion} 필수 + {@code trackId}(문자열)·{@code playing}(불리언) 중 최소
 * 하나다. 명시 null·알 수 없는 필드(volume·mute·positionSeconds 등 기기 로컬·서버 소유 값)는 400 이다.
 */
@RestController
@RequiredArgsConstructor
public class PlaybackController {

    private final PlaybackUseCase playback;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 재생 상태 — 저장된 anchor 그대로. 현재 위치는 앱이 serverNow 로 계산한다. */
    @GetMapping("/islands/{islandId}/playback")
    public PlaybackState get(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return playback.get(claims, uuid(islandId), deadline());
    }

    /** 재생 변경 — 같은 섬 주민 누구나, Idempotency-Key(UUID36) 필수. */
    @PatchMapping(value = "/islands/{islandId}/playback", consumes = "application/json")
    public PlaybackState patch(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        List<String> fields = new ArrayList<>();
        Map<String, Object> values = new LinkedHashMap<>();
        for (String name : body.propertyNames()) {
            JsonNode node = body.get(name);
            switch (name) {
                case "expectedVersion" -> { }
                case "trackId" -> {
                    if (node == null || !node.isString()) {
                        throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
                    }
                    fields.add(name);
                    values.put(name, node.stringValue());
                }
                case "playing" -> {
                    if (node == null || !node.isBoolean()) {
                        throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
                    }
                    fields.add(name);
                    values.put(name, node.booleanValue());
                }
                default -> throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
            }
        }
        if (fields.isEmpty()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        long expectedVersion = ResourceVersions.fromJson(body.get("expectedVersion"), "expectedVersion");
        return playback.patch(claims, uuid(islandId), fields, values, expectedVersion, key, deadline());
    }

    private static UUID uuid(String value) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "islandId");
        }
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}

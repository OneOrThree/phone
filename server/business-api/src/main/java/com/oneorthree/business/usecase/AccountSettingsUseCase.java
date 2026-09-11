package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/** 공개 설정 1필드의 내구 변경. legacy 5필드 흐름과 권한/오류 계약을 분리한다. */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountSettingsUseCase {

    private final DataApiClient data;
    private final NotificationApiClient notification;

    public Result read(AccessTokenClaims claims, Deadline deadline) {
        JsonNode snapshot = SettingsContract.snapshot(dataCall(() -> data.settingsSnapshot(
                claims.userId(), claims.sessionId(), claims.authGeneration(), deadline)), claims.authGeneration());
        JsonNode current = notificationCall(() ->
                notification.initializedSettings(claims.userId(), snapshot, deadline));
        return new Result(SettingsContract.bool(SettingsContract.settings(current), "notificationEnabled"));
    }

    public Result patch(AccessTokenClaims claims, boolean notifications, UUID key, Deadline deadline) {
        SettingsContract.Command command = SettingsContract.command(dataCall(() -> data.patchSettings(
                claims.userId(), claims.sessionId(), claims.authGeneration(), notifications, key, deadline)),
                notifications);
        JsonNode original = command.data();
        Map<String, Object> body = Map.of("mask", original.get("mask"), "patch", original.get("patch"),
                "baseline", original.get("baseline"), "authGeneration", original.get("authGeneration"));
        // 원 명령의 세대/결과를 유지한다. 현재 세대로 바꿔 tombstone을 우회하지 않는다.
        SettingsContract.applied(notificationCall(() -> notification.applySettingsPatch(claims.userId(), body,
                command.version(), command.id().toString(), deadline)));
        markDelivered(claims.userId(), command.id(), deadline);
        return new Result(command.notifications());
    }

    private void markDelivered(UUID userId, UUID commandId, Deadline deadline) {
        try {
            data.markCommandDelivered(userId, commandId, deadline);
        } catch (RuntimeException e) {
            // 완료 표시만 실패했다. 본문/토큰/상류 예외 원문을 남기지 않고 relay의 복구 대상으로 둔다.
            log.warn("공개 설정 outbox 완료 표시 실패 commandId={} failure={}",
                    commandId, e.getClass().getSimpleName());
        }
    }

    private <T> T dataCall(Supplier<T> action) {
        try {
            return action.get();
        } catch (UpstreamDomainException e) {
            if (e.getStatus() == 403 && "SESSION_NOT_ACTIVE".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
            }
            throw e;
        }
    }

    private <T> T notificationCall(Supplier<T> action) {
        try {
            return action.get();
        } catch (UpstreamDomainException e) {
            if (e.getStatus() == 409) {
                switch (e.getCode()) {
                    case "STALE_AUTH_GENERATION" -> throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
                    case "MIGRATION_NOT_READY" -> throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
                    case "SETTINGS_NOT_INITIALIZED" ->
                            throw new PublicApiException(ApiErrorCode.UPSTREAM_CONTRACT_ERROR, null);
                    default -> { }
                }
            }
            throw e;
        }
    }

    public record Result(boolean notifications) {
    }
}

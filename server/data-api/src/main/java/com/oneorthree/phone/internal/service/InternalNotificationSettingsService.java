package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.internal.dto.NotificationSettingsCommandResponse;
import com.oneorthree.phone.internal.dto.NotificationSettingsPatchRequest;
import com.oneorthree.phone.internal.dto.NotificationSettingsSnapshotRequest;
import com.oneorthree.phone.internal.dto.NotificationSettingsSnapshotResponse;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 설정의 사용자·세션·명령 결과를 같은 TX에서 조합한다. user 도메인이 auth를 역참조하지 않는다.
 * 잠금 순서는 기존 로그아웃과 같은 users → session → aggregate이며 외부 HTTP는 실행하지 않는다.
 */
@Service
@RequiredArgsConstructor
public class InternalNotificationSettingsService {
    private final UserQueryService users;
    private final AuthSessionService sessions;
    private final UserSatelliteCommandService settingsCommands;
    private final PublicCommandService publicCommands;
    private final AggregateVersionRepository aggregateVersions;

    /** 동일 키는 최초 patch/baseline/version/result를 재생하며 현재 세션 권한은 항상 다시 검사한다. */
    @Transactional
    public NotificationSettingsCommandResponse patch(UUID userId, NotificationSettingsPatchRequest request,
                                                     UUID idempotencyKey) {
        if (request.notifications() == null) {
            throw new IllegalArgumentException("notifications는 필수입니다.");
        }
        var command = new PublicCommandRequest(userId, "PATCH:/me/settings:" + userId, idempotencyKey,
                tree(Map.of("notifications", request.notifications())));
        var receipt = publicCommands.run(command,
                () -> authorize(userId, request.sessionId(), request.authGeneration()),
                ignored -> authorize(userId, request.sessionId(), request.authGeneration()),
                () -> {
                    EventEnvelope event = settingsCommands.patchNotificationSettings(userId, request.notifications());
                    var response = new NotificationSettingsCommandResponse(UUID.fromString(event.eventId()),
                            event.eventId(), event.version(), List.of("notificationEnabled"),
                            Map.of("notificationEnabled", request.notifications()),
                            UserSatelliteCommandService.snapshotOf(currentSettings(userId)),
                            request.authGeneration(), new NotificationSettingsCommandResponse.Result(
                                    request.notifications()));
                    return new PublicCommandResult(200, tree(response), tree(List.of(event)));
                }).value();
        try {
            return OutboxEnvelopeCodec.fromJson(receipt.data().toString(), NotificationSettingsCommandResponse.class);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }

    /** 기존 기본 설정 행의 실제 값만 반환한다. 행이 없다면 임의 true/default를 합성하지 않는다. */
    @Transactional
    public NotificationSettingsSnapshotResponse snapshot(UUID userId, NotificationSettingsSnapshotRequest request) {
        User user = authorize(userId, request.sessionId(), request.authGeneration());
        UserNotificationSettings settings = currentSettings(userId);
        long version = aggregateVersions.findForUpdate(AggregateRef.TYPE_USER, userId.toString())
                .map(AggregateVersion::getLastVersion).orElse(0L);
        return new NotificationSettingsSnapshotResponse(version, user.getAuthGeneration(),
                UserSatelliteCommandService.snapshotOf(settings));
    }

    private User authorize(UUID userId, UUID sessionId, Long authGeneration) {
        User user = users.getCallerForUpdate(userId);
        if (sessionId == null || authGeneration == null || authGeneration != user.getAuthGeneration()
                || sessions.verifySession(userId, sessionId).filter(row -> row.isActive()).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
        return user;
    }

    private UserNotificationSettings currentSettings(UUID userId) {
        UserNotificationSettings settings = users.getNotificationSettings(userId);
        if (settings.getDeletedAt() != null) {
            throw new UserException(UserErrorCode.USER_NOT_FOUND);
        }
        return settings;
    }

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("설정 명령 직렬화 실패", e);
        }
    }
}

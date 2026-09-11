package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.support.InternalCommands;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 유저 축 <b>내구 명령</b>의 제공자 — 기기 토큰 삭제 · 알림 설정 (A22 ⓖ · ㊲ · ㊷ · ㋕ · ㊿).
 *
 * <h2>왜 Data 가 먼저 적는가</h2>
 * 위성에 동기 호출만 하면 그 장애가 공통 HTTP 재시도보다 길 때 변경이 <b>영구 유실</b>된다. 앱은
 * 알림 설정 저장 실패를 <b>삼키고 「다음 변경 때」까지 재시도하지 않고</b>
 * ({@code NotificationSettingsScreen.tsx:142-148}), 기기 토큰 DELETE 실패도 삼킨 뒤 로컬 인증을
 * 지운다({@code App.tsx:528}). 그러면 사용자는 껐다고 보는데 정본은 계속 켜져 있고, 이전 계정 푸시가
 * 그 기기로 계속 간다.
 *
 * <h2>전환 기간에는 Data 의 «현행» 상태도 같이 바꾼다</h2>
 * 두 정본은 결국 {@code gromo_notification} 으로 넘어가지만, 컷오버 전까지는 기존 {@code /api} 경로와
 * Data 잔류 발송 잡이 <b>여기 있는 행</b>을 읽는다. outbox 만 적고 현행 행을 그대로 두면 「껐는데 Data
 * 잔류 잡이 계속 보낸다」가 남는다. 그래서 같은 트랜잭션에서 둘 다 쓴다.
 *
 * <h2>왜 {@code user} 도메인에 있는가</h2>
 * 두 명령을 부르는 자리가 둘이기 때문이다 — 내부 표면({@code /internal/*})과 <b>로그아웃</b>이다.
 * 로그아웃은 {@code auth} 도메인이고 내부 표면은 그보다 위라, 공통 조상인 {@code user}(모두가 참조할
 * 수 있는 바닥) 말고는 둘 다 닿을 수 있는 자리가 없다.
 *
 * <h2>{@code eventId} 는 순수 UUID 문자열이다</h2>
 * 명령 응답의 {@code commandId} 가 그 UUID 이고, 완료 표시는 그 값으로 온다(㊿). 접두사를 붙이면
 * 완료 표시 경로가 문자열을 되파싱해야 하고, 그 파싱이 곧 새로운 실패 지점이 된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserSatelliteCommandService {

    /** 사건 종류 — 기기 토큰 삭제 명령. */
    public static final String EVENT_DEVICE_TOKEN_DELETED = "notification.deviceToken.deleted";

    /** 사건 종류 — 알림 설정 전체 교체. */
    public static final String EVENT_SETTINGS_CHANGED = "notification.settings.changed";

    /** 알림 서버의 기기 토큰 삭제 논리 키. 실제 URL·토큰은 relay 설정의 허용목록에만 있다. */
    public static final String ENDPOINT_DEVICE_TOKEN_DELETED = "noti.deviceTokenDeleted";

    /** 알림 서버의 설정 적용 논리 키. */
    public static final String ENDPOINT_SETTINGS_APPLIED = "noti.settingsApplied";

    private static final int SCHEMA_VERSION = 1;

    private final UserRepository userRepository;
    private final UserQueryService userQueryService;
    private final OutboxCommandPort outboxCommandPort;

    /**
     * 위성 쓰기 전 활성 검사 (ⓖ).
     *
     * <p><b>실패를 「비활성」으로 접지 않는다</b> — 그러면 Data 장애가 「전원 탈퇴」라는 조용한 차단이
     * 되어 설정 변경·기기 등록이 전부 막힌다. 예외는 그대로 올라가 503 이 된다.
     *
     * @param userId 검사 대상
     * @return 쓰기를 허용해도 되는 상태인가
     * @throws UserException 유저 행 자체가 없으면 {@code USER_NOT_FOUND}(404). 코드 없는 404 는
     *     호출부에서 「계약 어긋남」이 되므로 반드시 코드를 실어 돌려준다
     */
    @Transactional(readOnly = true)
    public boolean isActive(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
        return !user.isDeleted();
    }

    /**
     * 기기 토큰 삭제를 <b>내구 기록</b>하고 Data 의 현행 토큰도 지운다 (㊲ · ㊿ · ㊨ · ㊪).
     *
     * <p>호출자는 이 기록이 끝난 <b>뒤에</b> 알림 서버 직접 삭제를 시도한다. 순서를 뒤집으면(실패 후에야
     * 기록) 그 사이 프로세스가 죽을 때 직접 삭제도 outbox 도 남지 않는다.
     *
     * <p><b>탈퇴 유저도 통과시킨다.</b> 자기 토큰을 지우는 일이라 활성 검사를 걸지 않는다 — 막으면
     * 탈퇴 직후의 로그아웃이 실패하고 이전 계정 푸시가 그 기기로 계속 간다.
     *
     * @param userId         대상 유저
     * @param request        대상 토큰·소유권 값·AT 세대. 셋 다 없을 수 있다
     * @param idempotencyKey {@code Idempotency-Key}. 없으면 이번 호출용 키를 만든다(㉼)
     * @return 완성된 봉투 — {@code eventId} 가 곧 완료 표시에 쓸 {@code commandId} 다
     */
    @Transactional
    public EventEnvelope recordDeviceTokenDeletion(
            UUID userId, DeviceTokenDeletionRequest request, String idempotencyKey) {

        return outboxCommandPort.runIdempotent(
                InternalCommands.idempotency(idempotencyKey, userId, "device-token-deletion",
                        request.deviceToken(), request.ownershipToken(), request.authGeneration()),
                EventEnvelope.class,
                () -> {
                    if (request.deviceToken() == null || request.deviceToken().isBlank()) {
                        // 구 앱은 대상 토큰을 못 보낸다(㊪). 유저 단위로 지우고 그 경합을 인정한다 —
                        // 남겨 두면 이전 계정 푸시가 계속 가는 쪽이 더 나쁘다.
                        log.info("기기 토큰 삭제 — 대상 토큰 없음(구 앱). 유저 단위로 처리한다. userId={}", userId);
                        userRepository.clearDeviceTokenUnconditionally(userId);
                    } else {
                        userRepository.clearDeviceTokenIncludingWithdrawn(userId, request.deviceToken());
                    }
                    Map<String, Object> params = new LinkedHashMap<>();
                    params.put("deviceToken", request.deviceToken());
                    params.put("ownershipToken", request.ownershipToken());
                    // ⚠️ null 을 «현재 세대»로 채우지 않는다(㊍) — 로그아웃 전에 발급된 옛 AT 가 최신
                    // 세대로 태깅돼 tombstone 을 우회한다. 없으면 없는 채로 보낸다.
                    params.put("authGeneration", request.authGeneration());
                    return append(EVENT_DEVICE_TOKEN_DELETED, userId, params,
                            OutboxDeliveryRequest.toNotification(ENDPOINT_DEVICE_TOKEN_DELETED, null));
                }).value();
    }

    /**
     * 알림 설정 <b>전체 교체</b>를 내구 기록하고 Data 의 현행 행도 갱신한다 (㊷ · ㋕).
     *
     * <p>응답의 {@code version} 이 역순 적용을 막는 유일한 값이다 — 「끔」이 알림 서버엔 성공했지만
     * 완료 표시만 실패하고 뒤이은 「켬」이 끝까지 성공하면, relay 가 남은 「끔」을 나중에 적용해
     * <b>사용자가 켠 설정을 도로 끈다</b>.
     *
     * @param userId         대상 유저
     * @param request        앱이 보낸 5필드 전부. 시각 null 은 「변경 안 함」이 아니라 <b>지움</b>이다
     * @param idempotencyKey {@code Idempotency-Key}
     * @return 완성된 봉투
     * @throws UserException 설정 행이 없거나 이미 파기됐으면 {@code USER_NOT_FOUND}
     */
    @Transactional
    public EventEnvelope recordNotificationSettings(
            UUID userId, NotificationSettingsRequest request, String idempotencyKey) {
        // 모든 설정 writer가 user → settings → aggregate 순서로 직렬화한다. 재생 전에도 탈퇴를 재검사한다.
        User user = userQueryService.getCallerForUpdate(userId);
        return outboxCommandPort.runIdempotent(
                InternalCommands.idempotency(idempotencyKey, userId, "notification-settings",
                        request.getNotificationEnabled(), request.getSoundEnabled(),
                        request.getNightModeEnabled(), request.getNightStartTime(), request.getNightEndTime()),
                EventEnvelope.class,
                () -> {
                    // ⚠️ 잠금 조회가 «상태 판독보다 앞»이다(㋕). 락 없이 읽으면 서로 다른 멱등 키의 두
                    // 요청이 같은 이전 상태를 본다 — 켜짐에서 「끄기」와 「켜짐 유지」가 겹치면 끄기가
                    // 먼저 커밋된 뒤 둘째는 더 높은 version 의 「켬」 봉투를 내보내지만 엔티티 스냅샷이
                    // 그대로라 Hibernate 가 UPDATE 를 생략한다. 그러면 Data 는 꺼짐 · 알림 서버는 켬이다.
                    // version 발급(append 안의 aggregate 잠금)에서만 직렬화해서는 늦다 — 그때는 이미
                    // 낡은 값을 읽은 뒤다. 사용자 행 다음에 설정 행, 마지막에 aggregate 행을 잠근다.
                    // 알림 전반의 잠금 순서 보증은 아니다 — 다중 수신자 USER 축 교착은
                    // GROMO-893 으로 미해결이다.
                    UserNotificationSettings settings = userQueryService.getNotificationSettingsForUpdate(userId);
                    if (settings.getDeletedAt() != null) {
                        throw new UserException(UserErrorCode.USER_NOT_FOUND);
                    }
                    settings.setNotificationEnabled(request.getNotificationEnabled());
                    settings.setSoundEnabled(request.getSoundEnabled());
                    settings.setNightModeEnabled(request.getNightModeEnabled());
                    settings.setNightStartTime(parseTime(request.getNightStartTime()));
                    settings.setNightEndTime(parseTime(request.getNightEndTime()));

                    // legacy 전체 요청은 그대로 보존한다. 소비자는 이 모양을 mask 5개로 처리해
                    // 신규 부분 변경과 같은 필드별 버전 경계에서 병합한다.
                    Map<String, Object> params = new LinkedHashMap<>();
                    params.put("notificationEnabled", request.getNotificationEnabled());
                    params.put("soundEnabled", request.getSoundEnabled());
                    params.put("nightModeEnabled", request.getNightModeEnabled());
                    params.put("nightStartTime", request.getNightStartTime());
                    params.put("nightEndTime", request.getNightEndTime());
                    params.put("authGeneration", user.getAuthGeneration());
                    return append(EVENT_SETTINGS_CHANGED, userId, params,
                            OutboxDeliveryRequest.toNotification(ENDPOINT_SETTINGS_APPLIED, null));
                }).value();
    }

    /**
     * 공개 알림 토글만 바꾸고 같은 TX에 필드 mask·patch를 적는다.
     * 호출부는 서명된 세션을 검증하고 PublicCommandService로 결과를 내구 저장해야 한다.
     */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public EventEnvelope patchNotificationSettings(UUID userId, boolean enabled) {
        User user = userQueryService.getCallerForUpdate(userId);
        UserNotificationSettings settings = userQueryService.getNotificationSettingsForUpdate(userId);
        if (settings.getDeletedAt() != null) {
            throw new UserException(UserErrorCode.USER_NOT_FOUND);
        }
        settings.setNotificationEnabled(enabled);
        return append(EVENT_SETTINGS_CHANGED, userId,
                Map.of("mask", List.of("notificationEnabled"),
                        "patch", Map.of("notificationEnabled", enabled),
                        "baseline", snapshotOf(settings),
                        "authGeneration", user.getAuthGeneration()),
                OutboxDeliveryRequest.toNotification(ENDPOINT_SETTINGS_APPLIED, null));
    }

    /** 잠금으로 보호된 mirror의 실제 5필드. 기본값을 별도 생성하지 않는다. */
    public static NotificationSettingsResponse snapshotOf(UserNotificationSettings settings) {
        return new NotificationSettingsResponse(settings.isNotificationEnabled(), settings.isSoundEnabled(),
                settings.isNightModeEnabled(),
                settings.getNightStartTime() == null ? null : settings.getNightStartTime().toString(),
                settings.getNightEndTime() == null ? null : settings.getNightEndTime().toString());
    }

    private static LocalTime parseTime(String value) {
        // null 입력은 「변경 안 함」이 아니라 «지움»이다 — 기존 updateNotificationSettings 와 같은 규칙.
        return value == null ? null : LocalTime.parse(value);
    }

    private EventEnvelope append(String type, UUID userId, Map<String, Object> params,
            OutboxDeliveryRequest delivery) {
        return outboxCommandPort.append(new OutboxAppendCommand(
                UUID.randomUUID().toString(), SCHEMA_VERSION, type, userId, null, null,
                AggregateRef.ofUser(userId), null, params, List.of(delivery)));
    }
}

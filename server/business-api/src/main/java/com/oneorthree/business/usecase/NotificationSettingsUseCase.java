package com.oneorthree.business.usecase;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.notification.dto.NotificationSettingsView;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 알림 설정 조합. 기존 앱 계약 {@code GET/PUT /api/v1/users/me/notification-settings} 를 보존한다.
 *
 * <h2>읽기는 알림 서버에서 — 정본이 거기 있다</h2>
 * 설정의 소유자는 {@code gromo_notification} 이라 <b>GET 도 알림 서버에서 읽는다</b>(§3). Data 패스스루로
 * 읽으면 이관 후 정본이 아닌 값을 주고, 그건 「껐는데 계속 오는」 상태를 화면에서 정상으로 보이게 한다.
 *
 * <h2>쓰기는 Data 내구 명령 먼저, 그다음 알림 전달</h2>
 * 순서가 계약이다(§3 · A22 ㊷ · ㋕):
 * <ol>
 *   <li><b>활성 검사</b> — 위성 쓰기 전(ⓖ).</li>
 *   <li><b>Data 에 내구 명령 저장</b> — 앱은 {@code NotificationSettingsScreen.tsx:142-148} 에서 화면을
 *       먼저 바꾼 뒤 서버 오류를 <b>삼키고 「다음 변경 때」까지 재시도하지 않는다</b>. 동기 호출만으로
 *       끝내면 알림 서버 장애가 공통 재시도보다 길 때 변경이 영구 유실되고, 사용자는 껐다고 보는데
 *       정본은 계속 true 라 푸시가 무기한 간다.</li>
 *   <li><b>알림 서버에 그 {@code version} 과 함께 전달</b> — 알림이 낮은 version 을 거부해야 역순 적용이
 *       막힌다(㋕): 「끔」이 알림엔 성공했지만 완료 표시만 실패하고 뒤이은 「켬」이 끝까지 성공하면,
 *       relay 가 남은 「끔」을 나중에 적용해 사용자가 켠 설정을 도로 끈다.</li>
 *   <li><b>성공 시 완료 표시</b> — 실패하면 relay 가 한 번 더 보낸다.</li>
 * </ol>
 *
 * <p><b>②가 성공하고 ③이 실패하면 요청은 실패다.</b> 성공으로 응답하면 앱은 다음 변경까지 재시도하지
 * 않고, 그 사이 relay 가 적용하기 전까지 정본은 옛 값이다 — 사용자가 껐다고 본 뒤에도 푸시가 간다.
 * 내구 기록이 남았으니 유실은 아니지만 «지금 적용됐다»고 말하지는 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationSettingsUseCase {

    private final ActiveUserGuard activeUserGuard;
    private final DataApiClient dataApiClient;
    private final NotificationApiClient notificationApiClient;

    /** 정본 조회. 읽기라 활성 검사를 걸지 않는다(§5: 읽기 전용 경로는 AT 3600s 창 수용). */
    public NotificationSettingsView read(UUID userId, Deadline deadline) {
        return notificationApiClient.getSettings(userId, deadline);
    }

    /**
     * 전체 교체 갱신. {@code settings} 는 앱이 보낸 5필드를 그대로 담은 값이어야 한다 —
     * 여기서 필드를 채우거나 기본값을 넣지 않는다(전체 교체가 계약이고, 세 플래그는 필수라
     * 생략하면 400 이다).
     */
    public void update(UUID userId, Object settings, RequestIdempotencyKeys keys, Deadline deadline) {
        activeUserGuard.requireActive(userId, deadline);

        DurableCommandAck recorded = dataApiClient.recordNotificationSettings(
                userId, settings, keys.forStep("settings-outbox"), deadline);

        notificationApiClient.applySettings(
                userId, settings, recorded.version(), keys.forStep("settings-apply"), deadline);

        markDeliveredQuietly(userId, recorded, deadline);
    }

    private void markDeliveredQuietly(UUID userId, DurableCommandAck recorded, Deadline deadline) {
        try {
            dataApiClient.markCommandDelivered(userId, recorded.commandId(), deadline);
        } catch (RuntimeException e) {
            log.warn("설정 outbox 완료 표시 실패 — relay 가 한 번 더 보낸다. commandId={}",
                    recorded.commandId(), e);
        }
    }
}

package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import com.oneorthree.phone.notification.service.PushNotificationService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;

/**
 * 구 경로와 신 경로가 갈리는 <b>단 하나의 자리</b> (계약 §5 · 1661 전환 전 공존).
 *
 * <h2>왜 판정 잡을 그대로 두는가</h2>
 * 「어떤 유저가 대상인가」는 코어 DB 를 읽어야 답할 수 있는 질문이다 — 리그 순위·스트릭·회차
 * 참가자·그룹 멤버십이 전부 {@code gromo} 에 있고, 알림 서버는 그 DB 를 읽지 않는다(계약 §2).
 * 그래서 판정은 Data 에 남고 <b>출력만</b> 바뀐다: FCM 직접 호출 → 결정적 사건 키를 담은 outbox 명령.
 *
 * <h2>지우지 않고 감싼다</h2>
 * 구 경로를 이 시점에 삭제하면 롤백 창이 사라진다(계약 §7 — 「기존 서비스 일괄 삭제 금지」).
 * 모드 판정을 <b>호출 지점마다</b> 흩으면 새로 붙는 kind 가 어느 쪽인지 모른 채 한쪽으로 조용히
 * 붙으므로, 판정을 여기 하나로 모은다.
 *
 * <h2>사일런트는 별도 진입점이다</h2>
 * 표시 푸시({@link #dispatch})는 구 경로에서 조용한 시간·알림 off 를 타지만 사일런트
 * ({@link #dispatchSilent})는 타지 않는다. 한 메서드로 합치면 {@code null} 제목 하나로 그 차이가
 * 갈려, 제목을 빠뜨린 표시 푸시가 조용히 사일런트가 된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationDispatcher {

    private final NotificationDispatchProperties properties;
    private final NotificationOutboxProducer producer;
    private final PushNotificationService pushNotificationService;

    /**
     * 표시 푸시 하나.
     *
     * @param user     수신자. 신 경로에서는 <b>토큰을 보지 않는다</b> — 기기 토큰의 정본이 알림 DB 로
     *                 옮겨 갔으므로 Data 의 사본으로 거르면 갱신이 늦은 쪽이 발송을 막는다
     * @param settings 알림 설정. 신 경로에서는 쓰이지 않는다(같은 이유)
     * @param request  판정이 끝난 요청 — 신 경로의 전부다
     * @param legacyMessage 구 경로로 나갈 완성 문구. 신 경로에서는 쓰이지 않는다
     * @param now      구 경로의 조용한 시간 판정 기준 시각
     * @return 결과. 호출부는 {@link NotificationDispatchOutcome#recordsLegacyLog()} 로
     *     {@code sent_log} 기록 여부를 가른다
     */
    public NotificationDispatchOutcome dispatch(User user, UserNotificationSettings settings,
                                                NotificationRequest request, PushMessage legacyMessage,
                                                Instant now) {
        if (properties.isOutboxMode()) {
            return producer.append(request).isPresent()
                    ? NotificationDispatchOutcome.QUEUED
                    : NotificationDispatchOutcome.DUPLICATE;
        }
        return pushNotificationService.sendIfAllowed(user, settings, legacyMessage, now)
                ? NotificationDispatchOutcome.SENT
                : NotificationDispatchOutcome.NOT_SENT;
    }

    /**
     * 사일런트(data-only) 푸시 하나 — 표시 필터를 타지 않는다.
     *
     * @param user          수신자
     * @param request       판정이 끝난 요청. kind 의 조용한 시간 정책은 {@code BYPASS} 여야 한다
     * @param legacyMessage 구 경로로 나갈 data payload
     * @return 결과
     */
    public NotificationDispatchOutcome dispatchSilent(User user, NotificationRequest request,
                                                      PushMessage legacyMessage) {
        if (properties.isOutboxMode()) {
            return producer.append(request).isPresent()
                    ? NotificationDispatchOutcome.QUEUED
                    : NotificationDispatchOutcome.DUPLICATE;
        }
        return pushNotificationService.sendSilentPush(user, legacyMessage)
                ? NotificationDispatchOutcome.SENT
                : NotificationDispatchOutcome.NOT_SENT;
    }

    /**
     * 신 경로에만 있는 요청형 사건을 적는다 — 구 경로 대응물이 없을 때 쓴다.
     *
     * <p>{@code BEFORE_COMMIT} 리스너가 이것을 부른다. 구 경로가 {@code AFTER_COMMIT} 이라
     * 같은 자리에 놓을 수 없기 때문이다.
     *
     * @param request 요청
     * @return 적었으면 {@code QUEUED}, 이미 있으면 {@code DUPLICATE}, 구 모드면 {@code NOT_SENT}
     */
    public NotificationDispatchOutcome enqueueOnly(NotificationRequest request) {
        if (!properties.isOutboxMode()) {
            return NotificationDispatchOutcome.NOT_SENT;
        }
        return producer.append(request).isPresent()
                ? NotificationDispatchOutcome.QUEUED
                : NotificationDispatchOutcome.DUPLICATE;
    }

    /** @return 신 경로인가 — 호출부가 구 클레임·flush 기계를 통째로 건너뛸 때 본다 */
    public boolean isOutboxMode() {
        return properties.isOutboxMode();
    }
}

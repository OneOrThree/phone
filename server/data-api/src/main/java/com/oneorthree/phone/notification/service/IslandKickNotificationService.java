package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.event.IslandKickedEvent;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/**
 * 섬 강퇴 알림 (GROMO-2315) — 강퇴된 본인 1명에게. 구조·경로·근거는 {@link MainIslandNotificationService} 와 같다:
 * 신 경로({@link #kickedRequest}, {@code BEFORE_COMMIT} outbox)와 구 경로({@link #notifyKicked}, {@code AFTER_COMMIT}
 * FCM)가 같은 요청을 만들고, 모드 판정은 {@link NotificationDispatcher} 하나다. 기본 모드가 {@code LEGACY} 라 구 경로를
 * 빼면 dev·prod 에서 이 알림이 한 건도 나가지 않는다.
 *
 * <p><b>문구</b> — 구 경로의 한국어 문장은 알림 서버 템플릿({@code ISLAND_KICKED.ko}, notification
 * {@code V9__island_kicked_catalog.sql})과 글자 그대로 같아야 한다. 강퇴 편지(「○○섬에서 …」)와 달리 이름 뒤에 «섬»을
 * 붙이지 않는다 — 이름이 이미 «섬»으로 끝나면 겹치고, 조사 «에서»는 받침과 무관해 이름을 그대로 둘 수 있다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IslandKickNotificationService {

    static final String TITLE = "섬에서 나가게 되었어요";
    static final String BODY_SUFFIX = "에서 더 이상 함께할 수 없게 되었어요";
    /** 홈 — 앱이 {@code GET /me/islands} 의 {@code lossReason=KICKED} 를 읽어 강퇴 안내 뒤 먼바다로 보낸다(GROMO-2366). */
    static final String DEEP_LINK = "gromo://home";

    private final UserQueryService userQueryService;
    private final NotificationDispatcher notificationDispatcher;
    private final NotificationSentLogRepository notificationSentLogRepository;

    /**
     * 신 경로 — 요청만 만든다. 적기는 같은 트랜잭션의 다른 사건과 합쳐 리스너가 한다.
     *
     * @param event 강퇴 사건
     * @return 알림 요청. 수신자가 탈퇴했으면 비어 있다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<NotificationRequest> kickedRequest(IslandKickedEvent event) {
        return requestOf(event).map(Ready::request);
    }

    /**
     * 구 경로 — 커밋 <b>뒤</b>에 FCM 으로 보낸다. 실제로 나간 건만 {@code sent_log} 에 남긴다.
     *
     * @param event 강퇴 사건
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyKicked(IslandKickedEvent event) {
        Ready ready = requestOf(event).orElse(null);
        if (ready == null) {
            log.debug("강퇴 알림 생략 — 탈퇴한 수신자, userId={}", event.userId());
            return;
        }
        Instant now = Instant.now();
        PushMessage message = new PushMessage(TITLE, event.islandName() + BODY_SUFFIX, DEEP_LINK,
                ready.settings() == null || ready.settings().isSoundEnabled(),
                Map.of("type", NotificationSentLog.TYPE_ISLAND_KICKED));
        if (notificationDispatcher.dispatch(ready.recipient(), ready.settings(), ready.request(), message, now)
                .recordsLegacyLog()) {
            // 섬은 target_user_id, subject_id 는 비운다 — 근거는 MainIslandNotificationService 의 같은 자리.
            notificationSentLogRepository.save(NotificationSentLog.builder()
                    .userId(event.userId())
                    .type(NotificationSentLog.TYPE_ISLAND_KICKED)
                    .targetUserId(event.islandId())
                    .sentAt(now)
                    .build());
        }
    }

    private Optional<Ready> requestOf(IslandKickedEvent event) {
        User recipient = userQueryService.findActive(event.userId()).orElse(null);
        if (recipient == null) {
            return Optional.empty();
        }
        UserNotificationSettings settings = userQueryService.findNotificationSettings(event.userId()).orElse(null);
        return Optional.of(new Ready(recipient, settings, new NotificationRequest(
                NotificationKind.ISLAND_KICKED, event.userId(), event.islandId(), null, null,
                event.occurredAt(), recipient.getLanguage(),
                Map.of("islandId", event.islandId().toString(), "islandName", event.islandName()))));
    }

    private record Ready(User recipient, UserNotificationSettings settings, NotificationRequest request) {
    }
}

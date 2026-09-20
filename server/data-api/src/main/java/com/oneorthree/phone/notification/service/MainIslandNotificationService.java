package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.event.MainIslandTransferredEvent;
import com.oneorthree.phone.group.service.MainIslandService;
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
 * 메인 섬 자동 이전 알림 (GROMO-1971) — <b>구 경로와 신 경로 양쪽으로 나간다</b>.
 *
 * <h2>왜 신 경로 전용으로 두지 않았는가</h2>
 * {@code notification.dispatch.mode} 의 기본값은 {@code LEGACY} 이고, OUTBOX 로 넘어가는 컷오버는
 * 앞단(dev VM 메모리·A18 relay 재시도 값)이 정해지지 않아 <b>시점이 없다</b>. 신 경로 전용으로 두면
 * 그동안 dev·prod 에서 이 알림이 한 건도 나가지 않는다 — 그런데 메인 섬 이전은 서버가 사용자가 고른
 * 값을 말없이 바꾸는 동작이라, 알림이 빠지면 기능이 절반만 산다.
 *
 * <h2>대가를 적어 둔다</h2>
 * 구 경로에도 얹었으므로 <b>컷오버 때 두 DB 의 발송 이력을 맞출 kind 가 하나 늘어난다</b>. 이것은
 * {@code NotificationDispatchProperties} 가 경고하는 「OUTBOX 로 올린 뒤 LEGACY 로 되돌리면 이미 나간
 * 알림이 다시 나간다」와 같은 축의 부채다 — 되돌림은 설정 한 줄이 아니라 이관 절차의 일부다.
 *
 * <h2>두 진입점</h2>
 * <ul>
 *   <li>{@link #transferredRequest} — 신 경로. {@code BEFORE_COMMIT} 리스너가 도메인 트랜잭션 «안에서»
 *       불러 사건을 outbox 에 적는다(원자성).
 *   <li>{@link #notifyTransferred} — 구 경로. {@code AFTER_COMMIT} + {@code @Async} 리스너가 부른다.
 *       FCM 왕복이 도메인 트랜잭션을 붙잡지 않아야 해서 커밋 뒤에 돌고, 그래서 {@code REQUIRES_NEW} 다
 *       ({@link FriendNotificationService} 와 같은 논증).
 * </ul>
 * 모드 판정 자체는 {@link NotificationDispatcher} 한 곳에 있고, 두 리스너가 서로의 모드에서 빠진다 —
 * 겹쳐 돌면 같은 알림이 FCM 으로도 가고 Kafka 로도 간다.
 *
 * <h2>문구</h2>
 * 구 경로에는 다국어 템플릿이 <b>없다</b> — 리그·친구·복귀 알림이 전부 서비스 안의 한국어 상수다
 * (2026-09-20 실측). 그 방식을 그대로 따르고, 수신자 언어는 신 경로의 {@code locale} 로만 실어 보낸다
 * (렌더는 알림 서버 몫 — {@link NotificationRequest} 주석). 여기서 새 문구 체계를 만들지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MainIslandNotificationService {

    static final String TITLE = "메인 섬이 바뀌었어요";
    static final String BODY_SUFFIX = "(으)로 메인 섬을 옮겼어요";

    /** 섬 딥링크 — 기존 그룹 라우팅을 그대로 쓴다(앱에 새 경로를 추가하지 않는다). */
    static final String ISLAND_DEEP_LINK_PREFIX = "gromo://group?g=";

    private final MainIslandService mainIslandService;
    private final UserQueryService userQueryService;
    private final NotificationDispatcher notificationDispatcher;
    private final NotificationSentLogRepository notificationSentLogRepository;

    /**
     * 신 경로 — 커밋 직전에 이 이전이 <b>여전히 사실인지</b> 확인하고 요청을 만든다. 적지는 않는다
     * (같은 트랜잭션의 다른 사건과 합쳐 적는 쪽이 수신자를 한 번에 잠근다).
     *
     * @param event 이전 사건
     * @return 알림 요청. 최종 상태와 어긋나거나 수신자가 탈퇴했으면 비어 있다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<NotificationRequest> transferredRequest(MainIslandTransferredEvent event) {
        return requestOf(event).map(Ready::request);
    }

    /**
     * 구 경로 — 커밋 <b>뒤</b>에 FCM 으로 보낸다.
     *
     * <p>{@link NotificationDispatcher#dispatch} 를 쓰는 이유는 모드 판정이 거기 하나뿐이기 때문이다.
     * 실제 발송이 성사된 건만 {@code sent_log} 에 남긴다 — 조용한 시간 스킵·토큰 없음을 발송으로
     * 오기록하지 않게, 기존 규율({@code recordsLegacyLog()})을 그대로 따른다.
     *
     * @param event 이전 사건
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyTransferred(MainIslandTransferredEvent event) {
        notifyTransferred(event, Instant.now());
    }

    /** 시각 주입 진입점(테스트) — 조용한 시간 경계를 고정해 검증하기 위한 오버로드. */
    void notifyTransferred(MainIslandTransferredEvent event, Instant now) {
        Ready ready = requestOf(event).orElse(null);
        if (ready == null) {
            log.debug("메인 섬 이전 알림 생략 — 최종 상태와 어긋남, userId={}", event.userId());
            return;
        }
        PushMessage message = new PushMessage(
                TITLE,
                event.islandName() + BODY_SUFFIX,
                ISLAND_DEEP_LINK_PREFIX + event.islandId(),
                ready.settings() == null || ready.settings().isSoundEnabled(),
                Map.of("type", NotificationSentLog.TYPE_MAIN_ISLAND_TRANSFERRED));

        if (notificationDispatcher.dispatch(ready.recipient(), ready.settings(), ready.request(), message, now)
                .recordsLegacyLog()) {
            notificationSentLogRepository.save(NotificationSentLog.builder()
                    .userId(event.userId())
                    .type(NotificationSentLog.TYPE_MAIN_ISLAND_TRANSFERRED)
                    .sentAt(now)
                    .build());
        }
    }

    /**
     * 두 경로가 <b>같은</b> 요청을 만들도록 조립을 한 곳에 둔다 — 한쪽만 고치면 모드에 따라 다른 알림이
     * 나가는데, 컷오버 중에는 그 차이가 드러나지 않는다.
     *
     * <p>두 가지를 다시 본다. ① 지금도 그 섬이 고른 메인 섬인가 — 계정 탈퇴는 한 트랜잭션에서 멤버십을
     * 여러 번 끝내므로 중간에 한 번 옮겨졌다가 마지막에 행이 지워질 수 있다. ② 수신자가 아직 활성인가.
     * 신 경로는 커밋 직전이라 자동 플러시가, 구 경로는 커밋 뒤라 커밋된 상태가 각각 그 답을 준다.
     */
    private Optional<Ready> requestOf(MainIslandTransferredEvent event) {
        if (!mainIslandService.isChosen(event.userId(), event.islandId())) {
            return Optional.empty();
        }
        User recipient = userQueryService.findActive(event.userId()).orElse(null);
        if (recipient == null) {
            return Optional.empty();
        }
        UserNotificationSettings settings = userQueryService
                .findNotificationSettings(event.userId())
                .orElse(null);
        return Optional.of(new Ready(recipient, settings, new NotificationRequest(
                NotificationKind.MAIN_ISLAND_TRANSFERRED, event.userId(), null, null, null,
                event.occurredAt(), recipient.getLanguage(),
                Map.of("islandId", event.islandId().toString(), "islandName", event.islandName()))));
    }

    /**
     * 판정을 통과한 한 건 — 구 경로가 {@code dispatch} 에 넘겨야 하는 세 값이 전부 여기 있다.
     *
     * @param recipient 활성 수신자
     * @param settings  알림 설정. 행이 없으면 null 이고 기본값으로 해석된다
     * @param request   신·구 공통 요청
     */
    private record Ready(User recipient, UserNotificationSettings settings, NotificationRequest request) {
    }
}

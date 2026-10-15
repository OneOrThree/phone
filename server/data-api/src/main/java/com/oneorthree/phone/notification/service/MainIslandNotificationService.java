package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.event.MainIslandTransferredEvent;
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
 * <h2>문구 — 경로마다 주인이 다르다</h2>
 * <b>구 경로에는 다국어 템플릿이 없다</b>(리그·친구·복귀가 전부 서비스 안의 한국어 상수다) — 그래서 여기서는
 * 한국어 상수 하나를 쓴다. <b>신 경로는 알림 서버가 ko·en·ja·zh-Hant 4종으로 렌더한다</b> — 그 템플릿이
 * {@code V2__notification_catalog.sql} 의 {@code MAIN_ISLAND_TRANSFERRED.*} 이고, 수신자 언어는
 * {@code NotificationRequest.locale} 로 실어 보낸다. 두 경로의 <b>한국어 문장은 같아야 한다</b> —
 * 컷오버에서 같은 알림의 문구가 조용히 바뀌면 그건 기능 변경이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MainIslandNotificationService {

    static final String TITLE = "메인 섬이 바뀌었어요";
    /**
     * 섬 이름이 <b>뒤</b>에 붙는다 — 신 경로 템플릿({@code MAIN_ISLAND_TRANSFERRED.ko}, V2 카탈로그)과
     * 글자 그대로 같은 문장이어야 컷오버에서 문구가 바뀌지 않는다. 한국어 조사를 피해 이름을 끝에 둔 것도
     * 그쪽과 같은 이유다({@code (으)로}·{@code 이(가)} 는 받침에 따라 갈린다).
     */
    static final String BODY_PREFIX = "떠난 섬 대신 새 메인 섬이 정해졌어요 — ";

    /** 섬 딥링크 — 기존 그룹 라우팅을 그대로 쓴다(앱에 새 경로를 추가하지 않는다). */
    static final String ISLAND_DEEP_LINK_PREFIX = "gromo://group?g=";

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
            log.debug("메인 섬 이전 알림 생략 — 탈퇴한 수신자, userId={}", event.userId());
            return;
        }
        PushMessage message = new PushMessage(
                TITLE,
                BODY_PREFIX + event.islandName(),
                ISLAND_DEEP_LINK_PREFIX + event.islandId(),
                ready.settings() == null || ready.settings().isSoundEnabled(),
                Map.of("type", NotificationSentLog.TYPE_MAIN_ISLAND_TRANSFERRED));

        if (notificationDispatcher.dispatch(ready.recipient(), ready.settings(), ready.request(), message, now)
                .recordsLegacyLog()) {
            // 섬은 target_user_id 에 싣고 subject_id 는 비운다 — 두 요구를 동시에 지켜야 한다.
            // ① subject_id 는 «발송 전 선점» 파이프라인의 유니크 축(user_id, kind, subject_id)이라,
            //    여기에 섬을 넣으면 재가입 후 같은 섬에서 다시 이탈할 때 유니크 위반으로 «기록»이 실패하고
            //    리스너 try/catch 가 삼켜 알림이 조용히 사라진다.
            // ② 그렇다고 대상을 아예 버리면 이 kind 가 SubjectKind.ISLAND 라서 이관 export 가
            //    FAIL_NO_SUBJECT 로 «중단»된다 — 성공 이력 한 건이 OUTBOX 컷오버를 막는다.
            // target_user_id 는 유니크 축이 아니고 「유저 외 식별자」를 싣는 것이 이미 규약이라
            //    (챌린지 id 선례, 엔티티 주석) 둘을 동시에 만족한다. 복원은 exporter 의 폴백 표가 한다.
            notificationSentLogRepository.save(NotificationSentLog.builder()
                    .userId(event.userId())
                    .type(NotificationSentLog.TYPE_MAIN_ISLAND_TRANSFERRED)
                    .targetUserId(event.islandId())
                    .sentAt(now)
                    .build());
        }
    }

    /**
     * 두 경로가 <b>같은</b> 요청을 만들도록 조립을 한 곳에 둔다 — 한쪽만 고치면 모드에 따라 다른 알림이
     * 나가는데, 컷오버 중에는 그 차이가 드러나지 않는다.
     *
     * <h2>거르는 것은 «탈퇴자» 하나뿐이다</h2>
     * 종전에는 「지금도 그 섬이 고른 메인 섬인가」도 함께 봤는데, 그 조건이 <b>모드에 따라 알림 수를
     * 갈랐다</b>. 신 경로는 커밋 «직전»에 두 이전을 모두 적으므로 A→C·C→B 가 둘 다 나가지만, 구 경로는
     * 커밋 «뒤» 비동기라 첫 작업이 돌기 전에 C→B 가 커밋되면 A→C 가 「최종 상태와 다르다」로 버려져
     * B 하나만 나갔다. 같은 사건에 1건과 2건이 되는 것은 계약 위반이다.
     *
     * <p><b>둘 다 보내는 쪽으로 맞춘다.</b> 연속으로 옮겨진 것은 사실이고 두 알림이 서로 다른 섬을
     * 가리키므로 사용자에게 거짓이 아니다. 「최종만」으로 맞추려면 신 경로도 좁혀야 하는데, 그쪽은
     * {@code BEFORE_COMMIT} 이라 「나중에 또 옮길지」를 알 수 없다.
     *
     * <p>원래 막으려던 것 — <b>계정 탈퇴 도중의 중간 이전이 탈퇴자에게 가는 것</b> — 은 활성 검사 하나로
     * 그대로 막힌다. 탈퇴는 멤버십 정리({@code detachWithdrawnUser})보다 <b>뒤</b>에 PII 를 파기하므로
     * ({@code AccountWithdrawalService}), 신 경로는 커밋 직전 자동 플러시가, 구 경로는 커밋된 상태가
     * 각각 {@code is_deleted} 를 보여 준다.
     */
    private Optional<Ready> requestOf(MainIslandTransferredEvent event) {
        User recipient = userQueryService.findActive(event.userId()).orElse(null);
        if (recipient == null) {
            return Optional.empty();
        }
        UserNotificationSettings settings = userQueryService
                .findNotificationSettings(event.userId())
                .orElse(null);
        // subjectId = 옮겨 간 섬. 결정적 키의 대상 축이라, 1분 안의 연속 이전(A→C, C→B)이 한 건으로
        // 접히지 않는다. params 에도 남기는 이유는 렌더 입력이기 때문이다 — 축과 입력은 다른 용도다.
        return Optional.of(new Ready(recipient, settings, new NotificationRequest(
                NotificationKind.MAIN_ISLAND_TRANSFERRED, event.userId(), event.islandId(), null, null,
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

package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.notification.producer.NotificationDispatchOutcome;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 친구 요청·수락 푸시 (GROMO-1090) — 크론이 아니라 <b>친구 도메인 이벤트</b>가 트리거다.
 *
 * <p>보내는 두 가지:
 * <ul>
 *   <li>요청 도착 → 받은 쪽에게 "○○님이 친구 요청을 보냈어요",
 *   <li>요청 수락 → 보냈던 쪽에게 "○○님이 친구 요청을 수락했어요".
 * </ul>
 * <b>거절은 알리지 않는다</b> — 거절 통보는 관계상 부담이라 스코프에서 뺐다.
 *
 * <p>{@code REQUIRES_NEW} 인 이유: 이 메서드는 친구 요청 트랜잭션이 <b>커밋된 뒤</b>
 * ({@code @TransactionalEventListener(AFTER_COMMIT)}) 호출된다. 그 시점의 영속성 컨텍스트는 이미
 * 커밋을 마쳐 더티체킹도 INSERT 도 반영되지 않으므로, 무효 토큰 정리(더티체킹)와 sent_log INSERT 를
 * 살리려면 새 쓰기 트랜잭션이 필요하다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FriendNotificationService {

    /** 친구 화면 딥링크(계약 §2). 앱의 {@code case 'friends':} 라우팅은 1088 앱 브랜치가 추가한다. */
    static final String FRIENDS_DEEP_LINK = "gromo://friends";

    static final String REQUEST_TITLE = "새로운 친구 요청";
    static final String REQUEST_BODY_SUFFIX = "님이 친구 요청을 보냈어요";
    static final String ACCEPTED_TITLE = "친구가 됐어요!";
    static final String ACCEPTED_BODY_SUFFIX = "님이 친구 요청을 수락했어요";

    /**
     * dedup 조회창 — (수신자, type, 상대) 조합으로 이 기간 안에 이미 보냈으면 다시 보내지 않는다.
     *
     * <p>여기서 남은 중복 경로는 <b>같은 행동이 동시에 두 번 처리되는</b> 경합뿐이다. 순차 재시도는
     * 발행 지점에서 이미 막았다 — 요청은 PENDING 이 있으면 409 로 걸리고, 수락은 실제 상태 전이일
     * 때만 이벤트를 낸다. 남는 것은 {@code reopen}(버전 없는 더티 업데이트) 동시 호출 둘이 나란히
     * 통과하는 경우이고, 이건 초 단위로 붙어서 일어난다.
     *
     * <p>그래서 창을 <b>1분</b>까지 좁혔다. 창이 길면 거절 뒤 상대가 다시 보낸 요청처럼 <b>별개의
     * 사용자 행동</b>까지 같은 키로 삼켜 통보가 사라진다(@claude·@codex 공통 지적). 1분이면 삼키는
     * 범위가 "동시에 처리된 같은 행동"으로 좁혀진다. 재요청 도배 억제는 발송 dedup 이 아니라 요청
     * 쿨다운(티켓 475)의 몫이다. 조회는 기존 인덱스 (user_id, type, sent_at) 를 그대로 탄다.
     *
     * <p><b>한계</b>: 판정과 기록 사이가 원자적이지 않다(유니크 제약 없음 — 제약 추가는 스키마 변경).
     * 정확히 동시에 도착한 경합 둘은 여전히 각각 발송될 수 있다. 결과가 중복 푸시 1건이라 감수한다.
     */
    static final Duration DEDUP_WINDOW = Duration.ofMinutes(1);

    private final FriendshipRepository friendshipRepository;
    private final UserQueryService userQueryService;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;
    private final NotificationDispatcher notificationDispatcher;
    private final EntityManager entityManager;

    /**
     * 친구 요청 도착 알림 — 수신자는 요청을 받은 유저.
     *
     * <p>발송 시점에 요청이 이미 수락·거절됐으면 보내지 않는다 — 눌러도 목록이 비어 있는
     * 알림을 띄우지 않기 위해서다.
     *
     * @param requestId      알릴 친구 요청. 이 id 로 아직 대기 중인지 다시 확인한다
     * @param receiverUserId 알림을 받을 사람(요청을 받은 쪽)
     * @param senderUserId   문구에 이름이 들어갈 사람(요청을 보낸 쪽)
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyFriendRequest(UUID requestId, UUID receiverUserId, UUID senderUserId) {
        notifyFriendRequest(requestId, receiverUserId, senderUserId, Instant.now());
    }

    /** 시각 주입 진입점(테스트) — dedup 창 경계를 고정해 검증하기 위한 오버로드. */
    void notifyFriendRequest(UUID requestId, UUID receiverUserId, UUID senderUserId, Instant now) {
        // 발송은 큐를 거치므로 요청 생성 시점과 여기 사이에 간격이 있다. 그 사이 수신자가 이미
        // 수락·거절했다면 "새 친구 요청" 은 거짓이고, 눌러서 들어가도 목록이 비어 있다(@codex 리뷰).
        if (!isStillPending(requestId)) {
            log.debug("이미 처리된 친구 요청 — 발송 생략, requestId={}", requestId);
            return;
        }
        send(receiverUserId, senderUserId, NotificationSentLog.TYPE_FRIEND_REQUEST,
                REQUEST_TITLE, REQUEST_BODY_SUFFIX, now);
    }

    /**
     * 요청이 아직 상대의 조치를 기다리는 상태인지. 삭제(탈퇴 정리)된 행도 없는 요청으로 본다.
     *
     * <p>수락 알림에는 같은 검사를 걸지 않는다 — 수락은 <b>이미 일어난 사실</b>의 통보라 그 뒤 친구가
     * 끊겨도 문구가 거짓이 되지 않지만, 요청 알림은 <b>지금 처리해야 할 일</b>을 가리키기 때문에 상태가
     * 바뀌면 그대로 거짓이 된다.
     *
     * <p>락 없는 조회를 쓴다({@code findStatusByIdAndDeletedAtIsNull}). 배타 락이 걸린
     * {@code findByIdAndDeletedAtIsNull} 은 수락·거절이 행을 <b>변경</b>하기 직전용이고, 이 트랜잭션은
     * FCM 발송이 끝나야 닫히므로 여기서 잠그면 같은 요청의 수락·거절과 탈퇴가 발송 시간만큼 대기한다
     * (@codex 리뷰 P1).
     */
    private boolean isStillPending(UUID requestId) {
        return friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId)
                .filter(FriendshipStatus.PENDING::equals)
                .isPresent();
    }

    /**
     * 친구 요청 수락 알림 — 수신자는 요청을 보냈던 유저.
     *
     * <p>요청 알림과 달리 상태를 다시 보지 않는다 — 수락은 이미 일어난 사실의 통보라
     * 그 뒤 친구가 끊겨도 문구가 거짓이 되지 않는다.
     *
     * @param requesterUserId 알림을 받을 사람(먼저 요청했던 쪽)
     * @param accepterUserId  문구에 이름이 들어갈 사람(수락한 쪽)
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyFriendAccepted(UUID requesterUserId, UUID accepterUserId) {
        notifyFriendAccepted(requesterUserId, accepterUserId, Instant.now());
    }

    /** 시각 주입 진입점(테스트) — {@link #notifyFriendRequest(UUID, UUID, Instant)} 와 같은 이유. */
    void notifyFriendAccepted(UUID requesterUserId, UUID accepterUserId, Instant now) {
        send(requesterUserId, accepterUserId, NotificationSentLog.TYPE_FRIEND_ACCEPTED,
                ACCEPTED_TITLE, ACCEPTED_BODY_SUFFIX, now);
    }

    /**
     * 신 경로 진입점(요청 도착) — <b>친구 요청 트랜잭션 안에서</b> 사건을 적는다.
     *
     * <p>구 경로는 {@code AFTER_COMMIT} + {@code @Async} 라 커밋 직후 프로세스가 죽으면 그 알림이
     * 사라진다. 친구 알림은 재훑기가 없어 영영 회수되지 않는다.
     *
     * <p>여기서는 「아직 대기 중인가」를 보지 않는다 — 커밋 전이라 아직 처리될 수 없다. 그 검사는
     * 발송 직전 {@code POST /internal/notifications/eligibility} 가 {@code params.requestId} 로 한다.
     *
     * @param requestId      방금 만들어지거나 되살아난 친구 요청 행
     * @param receiverUserId 알림을 받을 사람(요청을 받은 쪽)
     * @param senderUserId   문구에 이름이 들어갈 사람(요청을 보낸 쪽)
     * @return 적었으면 true
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean enqueueFriendRequestNotification(UUID requestId, UUID receiverUserId, UUID senderUserId) {
        Friendship row = friendshipRepository.findById(requestId).orElse(null);
        if (row == null) {
            return false;
        }
        return enqueue(receiverUserId, senderUserId, NotificationKind.FRIEND_REQUEST,
                requestId, occurredAtOf(row));
    }

    /**
     * 신 경로 진입점(수락) — <b>수락 트랜잭션 안에서</b> 사건을 적는다.
     *
     * <p>수락 이벤트는 요청 행 id 를 싣지 않으므로 (보낸이, 받은이) 로 행을 되찾는다. 그 행의
     * {@code updatedAt} 이 이번 수락의 시각이다.
     *
     * @param requesterUserId 알림을 받을 사람(먼저 요청했던 쪽)
     * @param accepterUserId  문구에 이름이 들어갈 사람(수락한 쪽)
     * @return 적었으면 true
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean enqueueFriendAcceptedNotification(UUID requesterUserId, UUID accepterUserId) {
        User requester = userQueryService.findActive(requesterUserId).orElse(null);
        User accepter = userQueryService.findActive(accepterUserId).orElse(null);
        if (requester == null || accepter == null) {
            return false;
        }
        Friendship row = friendshipRepository.findByFromUserAndToUser(requester, accepter).orElse(null);
        if (row == null) {
            return false;
        }
        return enqueue(requesterUserId, accepterUserId, NotificationKind.FRIEND_ACCEPTED,
                row.getId(), occurredAtOf(row));
    }

    /**
     * 사건의 <b>원본 발생 시각</b> — 친구 행의 {@code updatedAt}.
     *
     * <p>「지금」을 쓰지 않는다. 결정적 키의 분 단위 축이 호출 시각에서 나오면 같은 원인을 다시
     * 처리할 때 <b>다른 키</b>가 되어 멱등이 무너진다. 행의 시각은 커밋된 사실이라 몇 번을 다시
     * 읽어도 같다.
     *
     * <p>{@code createdAt} 이 아니라 {@code updatedAt} 인 이유는 이 도메인의 재요청이 <b>같은 행을
     * 되살리기</b> 때문이다({@code Friendship#reopen} · {@code #restore} — 그 주석도 같은 말을 한다).
     * {@code createdAt} 은 원래 관계의 시각으로 남으므로, 그걸 키에 쓰면 거절 후 재요청이 옛 사건 키에
     * 접혀 <b>영영 안 나간다</b>.
     *
     * <p>읽기 전에 flush 한다 — {@code @UpdateTimestamp} 는 flush 때 채워지는데 이 메서드는
     * {@code BEFORE_COMMIT} 단계, 즉 JPA 의 커밋 flush <b>전에</b> 돈다. 그냥 읽으면 방금 {@code reopen}
     * 한 행이 옛 시각을 들고 있다.
     *
     * @param row 친구 요청 행
     * @return 이번 전이의 시각. 아직 한 번도 갱신되지 않았으면 생성 시각
     */
    private Instant occurredAtOf(Friendship row) {
        entityManager.flush();
        return row.getUpdatedAt() == null ? row.getCreatedAt() : row.getUpdatedAt();
    }

    /**
     * 사건 하나를 적는다 — 상대 닉네임을 여기서 읽어 싣는다.
     *
     * <p>문구의 전부가 상대 닉네임인데 알림 서버는 코어 유저를 읽지 않는다(계약 §2). 상대가 없거나
     * 탈퇴자면 닉네임이 파기돼 <b>보낼 문구 자체가 없으므로</b> 적지 않는다.
     *
     * @param recipientId   수신자
     * @param counterpartId 문구에 이름이 들어갈 상대
     * @param kind          요청 도착인지 수락인지
     * @param requestId     친구 요청 행 id — 발송 직전 적격성 재확인의 판정 축이다(ⓜ · ㊩)
     * @param occurredAt    사건의 원본 발생 시각
     * @return 적었으면 true
     */
    private boolean enqueue(UUID recipientId, UUID counterpartId, NotificationKind kind,
                            UUID requestId, Instant occurredAt) {
        User recipient = userQueryService.findActive(recipientId).orElse(null);
        if (recipient == null) {
            return false;
        }
        String counterpartNickname = userQueryService.findActive(counterpartId)
                .map(User::getNickname)
                .orElse(null);
        if (counterpartNickname == null) {
            return false;
        }
        return notificationDispatcher.enqueueOnly(new NotificationRequest(kind, recipientId,
                counterpartId, null, null, occurredAt, recipient.getLanguage(),
                Map.of("counterpartUserId", counterpartId.toString(),
                        "counterpartNickname", counterpartNickname,
                        "requestId", requestId.toString())))
                == NotificationDispatchOutcome.QUEUED;
    }

    /**
     * 공통 발송 경로. 알림 on/off·토큰·quiet hours 판정은 전부
     * {@link PushNotificationService#sendIfAllowed} 에 맡기고, 여기서는 대상 확정·dedup·문구·기록만 한다.
     * 실제 발송이 성사된 건만 sent_log 에 남긴다(quiet hours 스킵을 발송으로 오기록하지 않기 위함).
     */
    private void send(UUID recipientId, UUID counterpartId, String type,
                      String title, String bodySuffix, Instant now) {
        // 탈퇴한 수신자에게는 보내지 않는다 — 탈퇴 트랜잭션과 이 알림이 경합할 수 있다(GROMO-801 계열).
        User recipient = userQueryService.findActive(recipientId).orElse(null);
        if (recipient == null) {
            return;
        }
        // 상대 닉네임이 문구의 전부라, 상대가 사라졌으면 보낼 문구 자체가 없다.
        // 탈퇴자도 마찬가지다 — 닉네임은 탈퇴 시 파기되므로 그 이름으로 알림을 보내면 안 된다(GROMO-1655).
        String counterpartNickname = userQueryService.findActive(counterpartId)
                .map(User::getNickname)
                .orElse(null);
        if (counterpartNickname == null) {
            return;
        }
        if (alreadySent(recipientId, counterpartId, type, now)) {
            log.debug("친구 알림 dedup — type={}, userId={}", type, recipientId);
            return;
        }

        UserNotificationSettings settings = userQueryService
                .findNotificationSettings(recipientId)
                .orElse(null);
        boolean soundEnabled = settings == null || settings.isSoundEnabled();
        PushMessage message = new PushMessage(
                title,
                counterpartNickname + bodySuffix,
                FRIENDS_DEEP_LINK,
                soundEnabled,
                Map.of("type", type));

        NotificationKind kind = NotificationSentLog.TYPE_FRIEND_REQUEST.equals(type)
                ? NotificationKind.FRIEND_REQUEST : NotificationKind.FRIEND_ACCEPTED;
        NotificationRequest request = new NotificationRequest(kind, recipientId, counterpartId, null,
                null, now, recipient.getLanguage(),
                Map.of("counterpartUserId", counterpartId.toString(),
                        "counterpartNickname", counterpartNickname));
        if (notificationDispatcher.dispatch(recipient, settings, request, message, now).recordsLegacyLog()) {
            notificationSentLogRepository.save(NotificationSentLog.builder()
                    .userId(recipientId)
                    .type(type)
                    .targetUserId(counterpartId)
                    .sentAt(now)
                    .build());
        }
    }

    /**
     * 최근 {@link #DEDUP_WINDOW} 안에 같은 (수신자, type, 상대) 조합으로 발송한 적이 있는지.
     * 인덱스를 타는 기존 조회(type + 유저 + 구간)를 그대로 쓰고 상대 판정만 메모리에서 접는다 —
     * 한 유저의 1분치 친구 알림이라 건수가 극소수다.
     */
    private boolean alreadySent(UUID recipientId, UUID counterpartId, String type, Instant now) {
        return notificationSentLogRepository
                .findByTypeAndUserIdInSince(type, List.of(recipientId), now.minus(DEDUP_WINDOW))
                .stream()
                .anyMatch(sentLog -> counterpartId.equals(sentLog.getTargetUserId()));
    }
}

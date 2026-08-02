package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
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
     * <p>여기서 접어야 하는 중복은 <b>한 번의 사용자 행동이 두 번의 발송이 되는</b> 경우뿐이다:
     * 수락은 상태를 검사하지 않고 {@code PENDING → ACCEPTED} 를 덮어써서 연타·재시도가 그대로 두 번째
     * 이벤트가 되고, 요청은 거절 후 재요청이 같은 행을 되살리는(reopen) 더티 업데이트라 동시 호출 둘이
     * 나란히 통과해 이벤트를 두 번 낼 수 있다. 둘 다 초 단위로 붙어서 일어난다.
     *
     * <p>그래서 창을 <b>짧게</b> 잡는다. 길게 잡으면(예: 24시간) 거절 뒤 상대가 다시 보낸 요청처럼
     * <b>별개의 사용자 행동</b>까지 같은 키로 삼켜 통보가 통째로 사라진다(@claude 리뷰 지적). 재요청
     * 도배를 눌러야 한다면 그건 발송 dedup 이 아니라 요청 쿨다운(티켓 475)의 몫이다.
     * 조회는 기존 인덱스 (user_id, type, sent_at) 를 그대로 탄다.
     */
    static final Duration DEDUP_WINDOW = Duration.ofMinutes(10);

    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /** 친구 요청 도착 알림 — 수신자는 요청을 받은 유저. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyFriendRequest(UUID receiverUserId, UUID senderUserId) {
        notifyFriendRequest(receiverUserId, senderUserId, Instant.now());
    }

    /** 시각 주입 진입점(테스트) — dedup 창 경계를 고정해 검증하기 위한 오버로드. */
    void notifyFriendRequest(UUID receiverUserId, UUID senderUserId, Instant now) {
        send(receiverUserId, senderUserId, NotificationSentLog.TYPE_FRIEND_REQUEST,
                REQUEST_TITLE, REQUEST_BODY_SUFFIX, now);
    }

    /** 친구 요청 수락 알림 — 수신자는 요청을 보냈던 유저. */
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
     * 공통 발송 경로. 알림 on/off·토큰·quiet hours 판정은 전부
     * {@link PushNotificationService#sendIfAllowed} 에 맡기고, 여기서는 대상 확정·dedup·문구·기록만 한다.
     * 실제 발송이 성사된 건만 sent_log 에 남긴다(quiet hours 스킵을 발송으로 오기록하지 않기 위함).
     */
    private void send(UUID recipientId, UUID counterpartId, String type,
                      String title, String bodySuffix, Instant now) {
        // 탈퇴한 수신자에게는 보내지 않는다 — 탈퇴 트랜잭션과 이 알림이 경합할 수 있다(GROMO-801 계열).
        User recipient = userRepository.findByIdAndIsDeletedFalse(recipientId).orElse(null);
        if (recipient == null) {
            return;
        }
        // 상대 닉네임이 문구의 전부라, 상대가 사라졌으면 보낼 문구 자체가 없다.
        String counterpartNickname = userRepository.findById(counterpartId)
                .map(User::getNickname)
                .orElse(null);
        if (counterpartNickname == null) {
            return;
        }
        if (alreadySent(recipientId, counterpartId, type, now)) {
            log.debug("친구 알림 dedup — type={}, userId={}", type, recipientId);
            return;
        }

        UserNotificationSettings settings = userNotificationSettingsRepository
                .findById(recipientId)
                .orElse(null);
        boolean soundEnabled = settings == null || settings.isSoundEnabled();
        PushMessage message = new PushMessage(
                title,
                counterpartNickname + bodySuffix,
                FRIENDS_DEEP_LINK,
                soundEnabled,
                Map.of("type", type));

        if (pushNotificationService.sendIfAllowed(recipient, settings, message, now)) {
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
     * 한 유저의 10분치 친구 알림이라 건수가 극소수다.
     */
    private boolean alreadySent(UUID recipientId, UUID counterpartId, String type, Instant now) {
        return notificationSentLogRepository
                .findByTypeAndUserIdInSince(type, List.of(recipientId), now.minus(DEDUP_WINDOW))
                .stream()
                .anyMatch(sentLog -> counterpartId.equals(sentLog.getTargetUserId()));
    }
}

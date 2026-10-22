package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserBlockService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** 친구 관계 전이의 알림 요청을 원본 트랜잭션 안에서 조립한다. */
@Service
@RequiredArgsConstructor
public class FriendNotificationService {
    private final FriendshipRepository friendshipRepository;
    private final UserQueryService userQueryService;
    private final UserBlockService userBlockService;

    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<NotificationRequest> friendRequestRequest(UUID requestId, UUID receiverUserId,
                                                              UUID senderUserId) {
        Friendship row = friendshipRepository.findById(requestId).orElse(null);
        if (row == null) {
            return Optional.empty();
        }
        return request(receiverUserId, senderUserId, NotificationKind.FRIEND_REQUEST,
                requestId, occurredAtOf(row));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<NotificationRequest> friendAcceptedRequest(UUID requesterUserId, UUID accepterUserId) {
        User requester = userQueryService.findActive(requesterUserId).orElse(null);
        User accepter = userQueryService.findActive(accepterUserId).orElse(null);
        if (requester == null || accepter == null) {
            return Optional.empty();
        }
        Friendship row = friendshipRepository.findByFromUserAndToUser(requester, accepter).orElse(null);
        if (row == null) {
            return Optional.empty();
        }
        return request(requesterUserId, accepterUserId, NotificationKind.FRIEND_ACCEPTED,
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
        // 저장소 경계를 통해 동시 요청의 유니크 위반을 409 도메인 응답으로 변환한다.
        friendshipRepository.flush();
        return row.getUpdatedAt() == null ? row.getCreatedAt() : row.getUpdatedAt();
    }

    /**
     * 사건 하나의 요청을 만든다 — 상대 닉네임을 여기서 읽어 싣는다.
     *
     * <p>문구의 전부가 상대 닉네임인데 알림 서버는 코어 유저를 읽지 않는다(계약 §2). 상대가 없거나
     * 탈퇴자면 닉네임이 파기돼 <b>보낼 문구 자체가 없으므로</b> 적지 않는다.
     *
     * @param recipientId   수신자
     * @param counterpartId 문구에 이름이 들어갈 상대
     * @param kind          요청 도착인지 수락인지
     * @param requestId     친구 요청 행 id — 발송 직전 적격성 재확인의 판정 축이다(ⓜ · ㊩)
     * @param occurredAt    사건의 원본 발생 시각
     * @return 요청. 수신자·상대가 없으면 비어 있다
     */
    private Optional<NotificationRequest> request(UUID recipientId, UUID counterpartId, NotificationKind kind,
                                                  UUID requestId, Instant occurredAt) {
        User recipient = userQueryService.findActive(recipientId).orElse(null);
        if (recipient == null) {
            return Optional.empty();
        }
        // 차단된 사이에는 적재하지 않는다 (GROMO-2180, policy RP-차단 「새 요청·편지 알림도 보내지 않는다」).
        // 적재 «뒤» 차단은 발송 직전 적격성 조회(NotificationEligibilityService.REASON_BLOCKED)가 거른다.
        if (userBlockService.isBlockedEither(recipientId, counterpartId)) {
            return Optional.empty();
        }
        String counterpartNickname = userQueryService.findActive(counterpartId)
                .map(User::getNickname)
                .orElse(null);
        if (counterpartNickname == null) {
            return Optional.empty();
        }
        return Optional.of(new NotificationRequest(kind, recipientId,
                counterpartId, occurredAt, recipient.getLanguage(),
                Map.of("counterpartUserId", counterpartId.toString(),
                        "counterpartNickname", counterpartNickname,
                        "requestId", requestId.toString())));
    }

}

package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationOutboxProducer;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 요청형 알림이 <b>도메인 커밋과 같은 원자 단위</b>로 남는지 — {@code AFTER_COMMIT} 유실 구간을
 * 실제로 닫았는지 본다 (A21 · 계약 §3).
 *
 * <h2>목으로는 세울 수 없는 성질</h2>
 * <ul>
 *   <li>{@code BEFORE_COMMIT} 단계에서 {@code Propagation.MANDATORY} 가 실제로 <b>원 트랜잭션에
 *       합류</b>하는가 — 새 트랜잭션이 열리면 원자성이 없다.</li>
 *   <li>그 단계에서 <b>지연 로딩과 재조회가 되는가</b> — 영속성 컨텍스트는 살아 있지만 JPA 의
 *       커밋 flush 는 아직이다. {@code @UpdateTimestamp} 같은 값은 flush 전에는 비어 있다.</li>
 *   <li>커밋된 요청에 사건이 <b>반드시</b> 따라붙는가.</li>
 * </ul>
 *
 * <p>친구 요청을 쓴다 — 요청형 다섯 중 fixture 가 가장 가볍고, 구 경로에 회수 수단이 아예 없어
 * 유실이 곧 영구 유실인 자리다.
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class NotificationRequestOutboxListenerIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    FriendService friendService;
    @Autowired
    FriendshipRepository friendshipRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    EventOutboxRepository outboxRepository;
    @Autowired
    EventOutboxDeliveryRepository deliveryRepository;
    @Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    private User sender;
    private User receiver;

    @BeforeEach
    void setUp() {
        sender = user("보낸이", "ko");
        receiver = user("받는이", "ja");
    }

    @AfterEach
    void tearDown() {
        friendshipRepository.deleteAll(friendshipRepository.findPair(sender, receiver));
        userRepository.deleteAll(List.of(sender, receiver));
    }

    private User user(String nickname, String language) {
        return userRepository.save(User.builder()
                .nickname(nickname + "-" + UUID.randomUUID().toString().substring(0, 8))
                .language(language)
                .build());
    }

    @Test
    @DisplayName("친구 요청이 커밋되면 사건도 함께 남는다 — 커밋과 리스너 사이의 유실 구간이 없다")
    void committedRequestAlwaysCarriesItsEvent() {
        friendService.createRequest(sender.getId(), receiver.getId());

        Friendship row = friendshipRepository.findPair(sender, receiver).get(0);
        // 키의 시간축은 «지금» 이 아니라 행의 updatedAt 이다 — 같은 원인을 다시 처리해도 같은 키여야 한다.
        String expectedKey = NotificationEventKey.of(NotificationKind.FRIEND_REQUEST,
                receiver.getId(), sender.getId(), row.getUpdatedAt());

        EventOutbox saved = outboxRepository.findByEventId(expectedKey).orElseThrow(() ->
                new AssertionError("커밋된 친구 요청에 사건이 따라붙지 않았다 — AFTER_COMMIT 유실 구간이 그대로다"));
        assertThat(saved.getType()).isEqualTo(NotificationOutboxProducer.EVENT_TYPE);
        assertThat(saved.getUserId()).isEqualTo(receiver.getId());
        // 수신자의 로케일이지 요청자의 것이 아니다 — 문구는 받는 사람의 언어로 렌더된다.
        assertThat(saved.getLocale()).isEqualTo("ja");
    }

    @Test
    @DisplayName("BEFORE_COMMIT 에서 상대 닉네임을 읽어 싣는다 — 알림 서버는 코어 유저를 읽지 않는다")
    void lazyLookupWorksBeforeCommit() {
        friendService.createRequest(sender.getId(), receiver.getId());

        Friendship row = friendshipRepository.findPair(sender, receiver).get(0);
        EventOutbox saved = outboxRepository.findByEventId(NotificationEventKey.of(
                NotificationKind.FRIEND_REQUEST, receiver.getId(), sender.getId(), row.getUpdatedAt()))
                .orElseThrow();

        // 커밋 «전» 단계에서 조회가 되지 않으면 이 값들이 비고, 그러면 알림 서버가 렌더할 문구가 없다.
        assertThat(saved.getParams())
                .containsEntry("kind", "FRIEND_REQUEST")
                .containsEntry("counterpartUserId", sender.getId().toString())
                .containsEntry("counterpartNickname", sender.getNickname())
                // 적격성 재확인의 판정 축 — 상대 유저 id 로는 거절 후 재요청을 구분할 수 없다.
                .containsEntry("requestId", row.getId().toString());
    }

    @Test
    @DisplayName("사건은 Kafka 전달 한 건과 함께 남는다 — 아무 데도 안 가는 봉투는 유실과 같다")
    void eventCarriesKafkaDelivery() {
        friendService.createRequest(sender.getId(), receiver.getId());

        Friendship row = friendshipRepository.findPair(sender, receiver).get(0);
        EventOutbox saved = outboxRepository.findByEventId(NotificationEventKey.of(
                NotificationKind.FRIEND_REQUEST, receiver.getId(), sender.getId(), row.getUpdatedAt()))
                .orElseThrow();

        List<EventOutboxDelivery> deliveries = deliveryRepository.findAll().stream()
                .filter(delivery -> delivery.getOutboxId().equals(saved.getId()))
                .toList();
        assertThat(deliveries).singleElement()
                .satisfies(delivery -> assertThat(delivery.getTarget()).isEqualTo(OutboxTarget.KAFKA));
    }

    @Test
    @DisplayName("재요청은 createdAt이 아닌 최근 updatedAt의 분 단위 중복 키를 사용한다")
    void reopenedRequestProducesNewEvent() {
        friendService.createRequest(sender.getId(), receiver.getId());
        Friendship first = friendshipRepository.findPair(sender, receiver).get(0);
        String firstKey = NotificationEventKey.of(NotificationKind.FRIEND_REQUEST,
                receiver.getId(), sender.getId(), first.getUpdatedAt());

        jdbc.update("UPDATE friendships SET created_at=created_at-interval '2 hours' WHERE id=?", first.getId());

        friendService.rejectRequest(receiver.getId(), first.getId());
        friendService.createRequest(sender.getId(), receiver.getId());

        Friendship reopened = friendshipRepository.findPair(sender, receiver).get(0);
        String secondKey = NotificationEventKey.of(NotificationKind.FRIEND_REQUEST,
                receiver.getId(), sender.getId(), reopened.getUpdatedAt());

        // 같은 행을 되살리므로 createdAt 은 그대로다. createdAt 으로 키를 만들었다면 재요청 알림이
        // 옛 키에 접혀 영영 나가지 않는다.
        assertThat(reopened.getId()).isEqualTo(first.getId());
        assertThat(outboxRepository.findByEventId(firstKey)).isPresent();
        assertThat(outboxRepository.findByEventId(secondKey)).isPresent();
        // 같은 분의 재요청은 dedup, 다음 분은 별도 사건이다. 벽시계 분 경계에서도 같은 계약이다.
        assertThat(outboxRepository.findAll().stream()
                .filter(event -> event.getUserId().equals(receiver.getId()))
                .map(EventOutbox::getEventId).toList())
                .containsExactlyInAnyOrderElementsOf(java.util.stream.Stream.of(firstKey, secondKey).distinct().toList());
    }
}

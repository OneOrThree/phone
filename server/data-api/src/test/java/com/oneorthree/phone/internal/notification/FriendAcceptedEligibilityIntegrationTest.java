package com.oneorthree.phone.internal.notification;

import tools.jackson.databind.ObjectMapper;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 outbox의 과거 닉네임을 보존한 채 현재 정본 상태를 HTTP 적격성 표면에서 다시 판정한다. */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
@AutoConfigureMockMvc
@Transactional
class FriendAcceptedEligibilityIntegrationTest {
    private static final String TOKEN = "friend-eligibility-noti-to-data";
    private static final String NICKNAME = "원래 상대 닉네임";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.notification.token", () -> TOKEN);
        registry.add("internal.api.callers.notification.allow[0]",
                () -> "POST /internal/notifications/eligibility");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired EntityManager entityManager;
    @Autowired UserRepository users;
    @Autowired FriendshipRepository friendships;
    @Autowired FriendNotificationService notifications;
    @Autowired FriendService friends;
    private User recipient;
    private User counterpart;

    @BeforeEach
    void setup() {
        recipient = users.saveAndFlush(User.builder().nickname("recipient-" + UUID.randomUUID()).build());
        counterpart = users.saveAndFlush(User.builder().nickname(NICKNAME).build());
    }

    @Test
    void withdrawalAfterRecordingTheEventSuppressesThePreservedNickname() throws Exception {
        Map<String, Object> event = acceptedEvent();
        evaluate(event).andExpect(jsonPath("$.eligible").value(true));
        UUID eventId = recordedEvent().getId();

        withdraw(counterpart.getId());
        evaluate(event).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("SUBJECT_GONE"));
        // DLT에서 복구할 원본을 고치거나 닉네임 유실을 기대하지 않는다. 적격성에서 전송을 막는다.
        assertThat(entityManager.find(EventOutbox.class, eventId).getParams())
                .containsEntry("counterpartNickname", NICKNAME);
    }

    @Test
    void aMissingCounterpartCannotMakeAnOldAcceptedEventEligible() throws Exception {
        evaluate(request("FRIEND_ACCEPTED", UUID.randomUUID(), Map.of("counterpartNickname", NICKNAME)))
                .andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("SUBJECT_GONE"));
    }

    @Test
    void endingTheFriendshipDoesNotInvalidateTheAcceptedFact() throws Exception {
        Map<String, Object> event = acceptedEvent();
        friends.detachWithdrawnUser(counterpart.getId(), Instant.now());
        flushAndClear();
        // 관계 정리만으로는 수락 사실이 거짓이 되지 않는다. 상대 계정은 여전히 활성이다.
        evaluate(event).andExpect(jsonPath("$.eligible").value(true));
    }

    @Test
    void adminTestsStillCheckTheCounterpartAndAllowTheActiveUserAsSubject() throws Exception {
        Map<String, Object> self = request("FRIEND_ACCEPTED", recipient.getId(), Map.of());
        self.put("adminTestRequestedAt", Instant.now().toString());
        evaluate(self).andExpect(jsonPath("$.eligible").value(true));

        Map<String, Object> event = acceptedEvent();
        event.put("adminTestRequestedAt", Instant.now().toString());
        withdraw(counterpart.getId());
        evaluate(event).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("SUBJECT_GONE"));
    }

    @Test
    void friendRequestAlreadyStopsWhenWithdrawalDeletesItsPendingRequest() throws Exception {
        Friendship friendship = friendships.saveAndFlush(Friendship.builder().fromUser(counterpart)
                .toUser(recipient).status(FriendshipStatus.PENDING).build());
        assertThat(notifications.enqueueFriendRequestNotification(friendship.getId(),
                recipient.getId(), counterpart.getId())).isTrue();
        flushAndClear();
        Map<String, Object> event = from(recordedEvent());
        evaluate(event).andExpect(jsonPath("$.eligible").value(true));
        withdraw(counterpart.getId());
        evaluate(event).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("REQUEST_RESOLVED"));
    }

    private Map<String, Object> acceptedEvent() {
        friendships.saveAndFlush(Friendship.builder().fromUser(recipient).toUser(counterpart)
                .status(FriendshipStatus.ACCEPTED).build());
        assertThat(notifications.enqueueFriendAcceptedNotification(recipient.getId(), counterpart.getId())).isTrue();
        flushAndClear();
        EventOutbox event = recordedEvent();
        assertThat(event.getSubjectId()).isEqualTo(counterpart.getId().toString());
        assertThat(event.getParams()).containsEntry("counterpartNickname", NICKNAME);
        return from(event);
    }

    private EventOutbox recordedEvent() {
        return entityManager.createQuery("SELECT event FROM EventOutbox event"
                        + " WHERE event.userId=:user AND event.type='notification.requested'", EventOutbox.class)
                .setParameter("user", recipient.getId()).getSingleResult();
    }

    private Map<String, Object> from(EventOutbox event) {
        return request(event.getParams().get("kind").toString(), UUID.fromString(event.getSubjectId()), event.getParams());
    }

    private Map<String, Object> request(String kind, UUID subject, Map<String, Object> params) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("userId", recipient.getId().toString());
        request.put("kind", kind);
        request.put("subjectId", subject.toString());
        request.put("params", params);
        return request;
    }

    private void withdraw(UUID userId) {
        friends.detachWithdrawnUser(userId, Instant.now());
        User user = users.findById(userId).orElseThrow();
        user.setDeleted(true);
        user.setNickname(null);
        flushAndClear();
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private ResultActions evaluate(Map<String, Object> body) throws Exception {
        return mvc.perform(post("/internal/notifications/eligibility")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", recipient.getId().toString())
                        .contentType("application/json").content(mapper.writeValueAsString(body)))
                .andExpect(status().isOk());
    }
}

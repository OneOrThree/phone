package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 우체통 Data 내부 표면 (GROMO-1775) — 실제 Flyway PostgreSQL · 실제 {@code InternalAuthFilter} 허용목록 위에서
 * 인가 술어·표시 projection·outbox 적재를 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class IslandMailboxInternalIntegrationTest {

    private static final String TOKEN = "test-svc-biz-to-data-mailbox";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/islands/*/mailbox-access");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/islands/*/message-authors");
        registry.add("internal.api.callers.business.allow[2]", () -> "POST /internal/islands/*/message-events");
    }

    @Autowired
    MockMvc mockMvc;
    @Autowired
    UserRepository userRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    EventOutboxRepository events;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager transactions;

    @Test
    @DisplayName("주민이면 200 — 본인 표시 projection 은 nickname 하나이고 catColor 는 실리지 않는다")
    void accessReturnsViewerForResident() throws Exception {
        String nickname = unique("수빈");
        UUID owner = newUser(nickname);
        Group island = newGroup(owner);

        mockMvc.perform(as(get("/internal/islands/" + island.getId() + "/mailbox-access"), owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(owner.toString()))
                .andExpect(jsonPath("$.name").value(nickname))
                .andExpect(jsonPath("$.catColor").doesNotExist());
    }

    @Test
    @DisplayName("비주민·없는 섬은 같은 403 MEMBER_ONLY — 임의 islandId 로 섬의 존재가 새지 않는다")
    void accessRejectsNonResidentAndUnknownIslandAlike() throws Exception {
        UUID owner = newUser(unique("주인"));
        UUID stranger = newUser(unique("남"));
        Group island = newGroup(owner);

        mockMvc.perform(as(get("/internal/islands/" + island.getId() + "/mailbox-access"), stranger))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_ONLY"));
        mockMvc.perform(as(get("/internal/islands/" + UUID.randomUUID() + "/mailbox-access"), stranger))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_ONLY"));
    }

    @Test
    @DisplayName("탈퇴한 요청자는 404 USER_NOT_FOUND — 본인 축이라 처방은 재로그인이다")
    void accessRejectsDeletedViewer() throws Exception {
        UUID owner = newUser(unique("떠난 사람"));
        Group island = newGroup(owner);
        jdbc.update("UPDATE users SET is_deleted = true WHERE id = ?", owner);

        mockMvc.perform(as(get("/internal/islands/" + island.getId() + "/mailbox-access"), owner))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
    }

    @Test
    @DisplayName("작성자 projection — 활성은 이름, 탈퇴는 name=null(키는 남는다), 없는 계정은 빠진다, 순서 유지·중복 제거")
    void authorsProjectNamesAndNullForDeleted() throws Exception {
        String nickname = unique("민지");
        UUID owner = newUser(nickname);
        UUID gone = newUser(unique("탈퇴자"));
        Group island = newGroup(owner);
        jdbc.update("UPDATE users SET is_deleted = true WHERE id = ?", gone);
        UUID ghost = UUID.randomUUID();

        mockMvc.perform(as(post("/internal/islands/" + island.getId() + "/message-authors"), owner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userIds\":[\"" + gone + "\",\"" + owner + "\",\"" + ghost + "\",\"" + owner + "\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authors.length()").value(2))
                .andExpect(jsonPath("$.authors[0].userId").value(gone.toString()))
                .andExpect(jsonPath("$.authors[0].name").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.authors[1].userId").value(owner.toString()))
                .andExpect(jsonPath("$.authors[1].name").value(nickname));
    }

    @Test
    @DisplayName("빈 목록·100 초과는 400 — 페이지 상한과 같다")
    void authorsRejectBadBatch() throws Exception {
        UUID owner = newUser(unique("민지"));
        Group island = newGroup(owner);
        StringBuilder many = new StringBuilder("{\"userIds\":[");
        for (int i = 0; i < 101; i++) {
            many.append(i > 0 ? "," : "").append('"').append(UUID.randomUUID()).append('"');
        }
        many.append("]}");

        mockMvc.perform(as(post("/internal/islands/" + island.getId() + "/message-authors"), owner)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"userIds\":[]}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(as(post("/internal/islands/" + island.getId() + "/message-authors"), owner)
                        .contentType(MediaType.APPLICATION_JSON).content(many.toString()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("message.created 는 한 번만 적히고 본문 없이(M02), 같은 messageId 재시도는 같은 봉투(version 1)를 재생한다")
    void messageEventAppendsOnceAndReplays() throws Exception {
        UUID author = newUser(unique("작성자"));
        Group island = newGroup(author);
        UUID messageId = UUID.randomUUID();
        String body = "{\"messageId\":\"" + messageId + "\",\"clientMessageId\":\"" + UUID.randomUUID()
                + "\",\"sentAt\":\"2026-09-18T09:10:00Z\"}";
        String eventId = "message.created:" + messageId;

        for (int attempt = 0; attempt < 2; attempt++) {
            mockMvc.perform(as(post("/internal/islands/" + island.getId() + "/message-events"), author)
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.eventId").value(eventId))
                    .andExpect(jsonPath("$.version").value(1));
        }

        assertThat(events.findByEventId(eventId)).isPresent();
        assertThat(events.findByEventId(eventId).orElseThrow().getVersion()).isEqualTo(1L);
        // 본문은 실리지 않는다(M02) — 식별자·시각 다섯 필드뿐.
        assertThat(events.findByEventId(eventId).orElseThrow().getParams())
                .containsOnlyKeys("messageId", "islandId", "senderId", "sentAt", "clientMessageId")
                .containsEntry("messageId", messageId.toString())
                .containsEntry("islandId", island.getId().toString())
                .containsEntry("senderId", author.toString());
        Integer realtimeDeliveries = jdbc.queryForObject(
                "SELECT COUNT(*) FROM event_outbox_deliveries d JOIN event_outbox e ON e.id = d.outbox_id "
                        + "WHERE e.event_id = ? AND d.target = 'REALTIME'", Integer.class, eventId);
        assertThat(realtimeDeliveries).isEqualTo(1);
    }

    @Test
    @DisplayName("허용목록 밖 경로는 같은 토큰으로도 403 — 우체통 자격이 다른 내부 표면을 열지 않는다")
    void allowlistDoesNotLeakIntoOtherSurfaces() throws Exception {
        UUID owner = newUser(unique("주인"));
        mockMvc.perform(as(get("/internal/users/" + owner + "/activation"), owner))
                .andExpect(status().isForbidden());
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, UUID userId) {
        return request.header("Authorization", "Bearer " + TOKEN).header("X-User-Id", userId.toString());
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    /** {@code users.nickname} 은 UNIQUE(uq_users_nickname)이고 DB 는 JVM 전체가 공유한다 — 접두어에 난수를 붙인다. */
    private UUID newUser(String nickname) {
        return tx().execute(status -> userRepository.save(User.builder().nickname(nickname).build()).getId());
    }

    private static String unique(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private Group newGroup(UUID ownerId) {
        return tx().execute(status -> {
            Group group = groupRepository.save(Group.builder().name("우체통 섬").maxMembers(10).build());
            groupMemberRepository.save(GroupMember.builder()
                    .user(userRepository.findById(ownerId).orElseThrow())
                    .group(group)
                    .role(GroupMemberRole.OWNER)
                    .build());
            return group;
        });
    }
}

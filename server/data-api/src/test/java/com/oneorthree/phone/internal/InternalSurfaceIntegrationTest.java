package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 내부 표면의 <b>실제 생산 배선</b> 검증 (GROMO-1659 · 1660 / A22).
 *
 * <p>실물 PostgreSQL + <b>실제 Flyway V1~V52</b> 위에서 돈다({@code ddl-auto=validate}) — 수동 DDL 도
 * {@code create-drop} 도 쓰지 않으므로 엔티티와 마이그레이션의 드리프트가 여기서 드러난다. 그 드리프트는
 * 원래 dev 부팅에서만 터진다.
 *
 * <p>{@code internal.api} 를 <b>실제 설정 모양 그대로</b> 켠다 — caller 별 토큰과 {@code METHOD /path}
 * 허용목록이 바인딩되는지까지 함께 본다. 목으로 필터를 대신 세우면 정작 운영에서 쓰는 바인딩이
 * 한 번도 실행되지 않는다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class InternalSurfaceIntegrationTest {

    private static final String BIZ_TOKEN = "test-svc-biz-to-data";
    private static final String NOTI_TOKEN = "test-svc-noti-to-data";
    /** 운영 이관 자격 — 서비스 토큰 7종과 «공유하지 않는» 별도 운영자 키다. */

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> BIZ_TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/activation");
        registry.add("internal.api.callers.business.allow[1]",
                () -> "POST /internal/auth/device-sessions/verify");
        registry.add("internal.api.callers.business.allow[2]",
                () -> "POST /internal/users/*/device-token-deletions");
        registry.add("internal.api.callers.business.allow[3]",
                () -> "PUT /internal/users/*/notification-settings-commands");
        registry.add("internal.api.callers.business.allow[4]",
                () -> "POST /internal/outbox-commands/*/delivered");
        registry.add("internal.api.callers.business.allow[5]",
                () -> "POST /internal/auth/sessions/verify");
        registry.add("internal.api.callers.notification.token", () -> NOTI_TOKEN);
        registry.add("internal.api.callers.notification.allow[0]",
                () -> "GET /internal/users/notification-snapshot");

    }

    /**
     * {@code @AutoConfigureMockMvc} 가 만든 것이라 <b>등록된 서블릿 필터가 그대로 붙는다</b>.
     * {@code webAppContextSetup} 으로 직접 세우면 {@code FilterRegistrationBean} 이 빠져, 정작
     * 검증하려는 관문({@code InternalAuthFilter})을 통과하지 않은 채 초록이 된다.
     */
    @Autowired
    MockMvc mockMvc;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupInviteLinkRepository groupInviteLinkRepository;
    @Autowired
    AuthSessionRepository authSessionRepository;
    @Autowired
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    EventOutboxDeliveryRepository eventOutboxDeliveryRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private UUID newUser() {
        return tx().execute(status -> {
            User user = userRepository.save(User.builder().build());
            userNotificationSettingsRepository.save(
                    UserNotificationSettings.builder().userId(user.getId()).build());
            return user.getId();
        });
    }

    private Group newGroup(UUID ownerId) {
        return tx().execute(status -> {
            Group group = groupRepository.save(Group.builder().name("테스트 그룹").maxMembers(10).build());
            groupMemberRepository.save(GroupMember.builder()
                    .user(userRepository.findById(ownerId).orElseThrow())
                    .group(group)
                    .role(GroupMemberRole.OWNER)
                    .build());
            return group;
        });
    }

    private List<EventOutbox> envelopesOf(UUID userId, String type) {
        return eventOutboxRepository.findAll().stream()
                .filter(row -> row.getUserId().equals(userId) && row.getType().equals(type))
                .toList();
    }

    @Test
    @DisplayName("서비스 토큰이 없으면 내부 표면에 닿지 못한다 — 앱 AT 로는 아예 경로가 없다")
    void internalSurfaceRequiresServiceToken() throws Exception {
        UUID userId = newUser();

        mockMvc.perform(get("/internal/users/{id}/activation", userId)
                        .header("X-User-Id", userId.toString()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("활성 검사는 탈퇴를 false 로 답한다 — 그리고 authGeneration 을 «담지 않는다»(㊍)")
    void activationReportsWithdrawnAsInactiveWithoutGeneration() throws Exception {
        UUID userId = newUser();

        mockMvc.perform(get("/internal/users/{id}/activation", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.authGeneration").doesNotExist());

        tx().executeWithoutResult(status -> {
            User user = userRepository.findById(userId).orElseThrow();
            user.setDeleted(true);
            userRepository.save(user);
        });

        mockMvc.perform(get("/internal/users/{id}/activation", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    @DisplayName("기기 토큰 삭제는 NOTI outbox 를 남긴다 — commandId 가 곧 eventId 다")
    void deviceTokenDeletionRecordsOutbox() throws Exception {
        UUID userId = newUser();

        String body = mockMvc.perform(post("/internal/users/{id}/device-token-deletions", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .header("Idempotency-Key", "app-key-1")
                        .contentType("application/json")
                        .content("{\"deviceToken\":\"fcm-token-1\",\"ownershipToken\":null,"
                                + "\"authGeneration\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").exists())
                .andReturn().getResponse().getContentAsString();


        List<EventOutbox> envelopes =
                envelopesOf(userId, "notification.deviceToken.deleted");
        assertThat(envelopes).hasSize(1);
        // 요청형 eventId 는 «순수 UUID 문자열»이다 — 완료 표시가 그 값을 되파싱 없이 쓴다.
        assertThat(body).contains(envelopes.get(0).getEventId());
        assertThat(UUID.fromString(envelopes.get(0).getEventId())).isNotNull();
        // 세대는 없는 채로 실린다(㊍) — 여기서 현재 세대를 채우면 tombstone 우회다.
        assertThat(envelopes.get(0).getParams()).containsEntry("authGeneration", null);

        List<EventOutboxDelivery> deliveries =
                eventOutboxDeliveryRepository.findByOutboxId(envelopes.get(0).getId());
        assertThat(deliveries).singleElement()
                .satisfies(delivery -> {
                    assertThat(delivery.getTarget()).isEqualTo(OutboxTarget.NOTI);
                    assertThat(delivery.getEndpointKey()).isEqualTo("noti.deviceTokenDeleted");
                    assertThat(delivery.getDeliveredAt()).isNull();
                });
    }

    @Test
    void headerlessDeletionCarriesItsSessionScope() throws Exception {
        UUID userId = newUser();
        String hash = TokenHasher.sha256Hex("device-bootstrap");
        UUID sessionId = tx().execute(status -> {
            return authSessionRepository.save(AuthSession.builder().userId(userId)
                    .refreshTokenHash(TokenHasher.sha256Hex("rt-" + userId))
                    .bootstrapNonceHash(hash).sessionEpoch(3L).build()).getId();
        });
        mockMvc.perform(post("/internal/users/{id}/device-token-deletions", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .header("Idempotency-Key", "session-delete")
                        .contentType("application/json")
                        .content("{\"deviceToken\":null,\"ownershipToken\":null,\"authGeneration\":0,"
                                + "\"sessionId\":\"" + sessionId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.params.sessionId").value(sessionId.toString()))
                .andExpect(jsonPath("$.params.bootstrapNonceHash").value(hash));
        assertThat(envelopesOf(userId, "notification.deviceToken.deleted")).singleElement()
                .satisfies(event -> assertThat(event.getParams())
                        .containsEntry("sessionId", sessionId.toString())
                        .containsEntry("bootstrapNonceHash", hash));
    }

    @Test
    void deletionRejectsAnotherUsersSessionBeforeCreatingAnOutbox() throws Exception {
        UUID userId = newUser();
        UUID otherUser = newUser();
        UUID sessionId = tx().execute(status -> authSessionRepository.save(AuthSession.builder()
                .userId(otherUser).refreshTokenHash(TokenHasher.sha256Hex("rt-" + otherUser))
                .bootstrapNonceHash(TokenHasher.sha256Hex("other-bootstrap")).sessionEpoch(1L).build()).getId());
        mockMvc.perform(post("/internal/users/{id}/device-token-deletions", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString()).header("Idempotency-Key", "foreign-session")
                        .contentType("application/json").content("{\"sessionId\":\"" + sessionId + "\"}"))
                .andExpect(status().isForbidden());
        assertThat(envelopesOf(userId, "notification.deviceToken.deleted")).isEmpty();
    }

    @Test
    @DisplayName("같은 멱등 키의 재시도는 «같은 봉투»를 재생한다 — 새 outbox 행을 만들지 않는다")
    void sameIdempotencyKeyReplaysTheSameEnvelope() throws Exception {
        UUID userId = newUser();

        String first = mockMvc.perform(put("/internal/users/{id}/notification-settings-commands", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .header("Idempotency-Key", "app-settings-1")
                        .contentType("application/json")
                        .content(settingsJson(false)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String second = mockMvc.perform(put("/internal/users/{id}/notification-settings-commands", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .header("Idempotency-Key", "app-settings-1")
                        .contentType("application/json")
                        .content(settingsJson(false)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(second).isEqualTo(first);
        assertThat(envelopesOf(userId, "notification.settings.changed")).hasSize(1);
    }

    @Test
    @DisplayName("설정 변경은 Data 현행 행도 바꾸고 version 이 단조 증가한다 — 역순 적용을 막는 유일한 값이다")
    void settingsCommandUpdatesCurrentRowAndAdvancesVersion() throws Exception {
        UUID userId = newUser();

        long firstVersion = versionOf(mockMvc.perform(
                        put("/internal/users/{id}/notification-settings-commands", userId)
                                .header("Authorization", "Bearer " + BIZ_TOKEN)
                                .header("X-User-Id", userId.toString())
                                .header("Idempotency-Key", "k1")
                                .contentType("application/json")
                                .content(settingsJson(false)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(userNotificationSettingsRepository.findById(userId).orElseThrow()
                .isNotificationEnabled()).isFalse();

        long secondVersion = versionOf(mockMvc.perform(
                        put("/internal/users/{id}/notification-settings-commands", userId)
                                .header("Authorization", "Bearer " + BIZ_TOKEN)
                                .header("X-User-Id", userId.toString())
                                .header("Idempotency-Key", "k2")
                                .contentType("application/json")
                                .content(settingsJson(true)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(secondVersion).isGreaterThan(firstVersion);
        assertThat(userNotificationSettingsRepository.findById(userId).orElseThrow()
                .isNotificationEnabled()).isTrue();
    }

    @Test
    @DisplayName("완료 표시는 멱등이고, 남의 명령 id 로는 아무것도 닫지 못한다")
    void markDeliveredIsIdempotentAndOwnershipChecked() throws Exception {
        UUID userId = newUser();
        UUID other = newUser();

        String body = mockMvc.perform(put("/internal/users/{id}/notification-settings-commands", userId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .header("Idempotency-Key", "k-ack")
                        .contentType("application/json")
                        .content(settingsJson(true)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String commandId = valueOf(body, "commandId");

        mockMvc.perform(post("/internal/outbox-commands/{id}/delivered", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString()))
                .andExpect(status().isOk());
        // 두 번째도 200 — 409 면 호출자가 정상 중복을 오류로 남긴다.
        mockMvc.perform(post("/internal/outbox-commands/{id}/delivered", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString()))
                .andExpect(status().isOk());

        EventOutbox envelope = eventOutboxRepository.findByEventId(commandId).orElseThrow();
        assertThat(eventOutboxDeliveryRepository
                .findByOutboxIdAndTarget(envelope.getId(), OutboxTarget.NOTI).orElseThrow()
                .getDeliveredAt()).isNotNull();

        // 남의 명령을 닫으려는 시도 — 존재 여부가 응답으로 새지 않도록 한 코드로 접힌다.
        mockMvc.perform(post("/internal/outbox-commands/{id}/delivered", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", other.toString()))
                .andExpect(status().is4xxClientError());
    }

    @Test
    @DisplayName("허용목록 밖 경로는 caller 가 맞아도 403 이다 — 이름만 나누면 최소 권한이 서지 않는다")
    void allowlistIsEnforcedPerCallerOnRealBinding() throws Exception {
        UUID userId = newUser();

        // 알림 caller 에게만 열린 경로에 Business 자격으로 온다(㉱). 그 경로의 «구현»은 별도
        // 작업자 소유라 여기서 200 을 기대하지 않는다 — 검증 대상은 관문이 caller 를 가르는가다.
        mockMvc.perform(get("/internal/users/notification-snapshot")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString()))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("세션 확인은 살아 있는 세션에만 true 이고, 폐기 뒤에도 마지막 epoch 을 준다")
    void deviceSessionVerifyReturnsFencingValueEvenWhenInactive() throws Exception {
        UUID userId = newUser();
        String bootstrap = "bootstrap-" + UUID.randomUUID();
        long epoch = 7L;
        tx().executeWithoutResult(status -> authSessionRepository.save(AuthSession.builder()
                .userId(userId)
                .refreshTokenHash(TokenHasher.sha256Hex("rt-" + userId))
                .bootstrapNonceHash(TokenHasher.sha256Hex(bootstrap))
                .sessionEpoch(epoch)
                .build()));

        mockMvc.perform(post("/internal/auth/device-sessions/verify")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .contentType("application/json")
                        .content("{\"deviceBootstrap\":\"" + bootstrap + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.sessionEpoch").value((int) epoch));

        tx().executeWithoutResult(status -> {
            AuthSession session = authSessionRepository
                    .findByRefreshTokenHash(TokenHasher.sha256Hex("rt-" + userId)).orElseThrow();
            session.revoke(Instant.now(), "LOGOUT");
            authSessionRepository.save(session);
        });

        mockMvc.perform(post("/internal/auth/device-sessions/verify")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .contentType("application/json")
                        .content("{\"deviceBootstrap\":\"" + bootstrap + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false))
                // 비활성일 때도 마지막 값을 준다 — 0 을 주면 지연 등록이 「가장 오래된 값」으로 통과한다.
                .andExpect(jsonPath("$.sessionEpoch").value((int) epoch));

        // 남의 자격으로는 조회되지 않는다 — 조회 조건에 userId 가 함께 들어간다.
        UUID other = newUser();
        mockMvc.perform(post("/internal/auth/device-sessions/verify")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", other.toString())
                        .contentType("application/json")
                        .content("{\"deviceBootstrap\":\"" + bootstrap + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.sessionEpoch").value(0));
    }

    @Test
    @DisplayName("서명된 sid 확인은 살아 있는 세션에만 true 이고, 자격(bootstrap)은 절대 돌려주지 않는다")
    void sessionVerifyBySignedIdNeverReturnsTheBootstrapCredential() throws Exception {
        UUID userId = newUser();
        String bootstrap = "bootstrap-" + UUID.randomUUID();
        long epoch = 11L;
        tx().executeWithoutResult(status -> authSessionRepository.save(AuthSession.builder()
                .userId(userId)
                .refreshTokenHash(TokenHasher.sha256Hex("rt-sid-" + userId))
                .bootstrapNonceHash(TokenHasher.sha256Hex(bootstrap))
                .sessionEpoch(epoch)
                .build()));
        UUID sessionId = authSessionRepository
                .findByRefreshTokenHash(TokenHasher.sha256Hex("rt-sid-" + userId)).orElseThrow().getId();

        String body = mockMvc.perform(post("/internal/auth/sessions/verify")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .contentType("application/json")
                        .content("{\"sessionId\":\"" + sessionId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.sessionEpoch").value((int) epoch))
                .andReturn().getResponse().getContentAsString();
        // 이 표면은 «확인»만 한다. 자격을 돌려주면 저장하지 않는 앱에 1회용 자격을 발급하는 셈이라
        // 소유권 이전이 자격 없이 성립하게 된다(= bootstrap 위조).
        assertThat(body).doesNotContain(bootstrap, TokenHasher.sha256Hex(bootstrap));

        tx().executeWithoutResult(status -> {
            AuthSession session = authSessionRepository
                    .findByRefreshTokenHash(TokenHasher.sha256Hex("rt-sid-" + userId)).orElseThrow();
            session.revoke(Instant.now(), "LOGOUT");
            authSessionRepository.save(session);
        });

        // 로그아웃 뒤에도 그 세션의 AT 는 만료 전까지 서명이 유효하다 — 그 AT 로 오는 등록을 막는 것이
        // 이 확인의 존재 이유다.
        mockMvc.perform(post("/internal/auth/sessions/verify")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .contentType("application/json")
                        .content("{\"sessionId\":\"" + sessionId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.sessionEpoch").value((int) epoch));

        // 남의 sid 는 조회되지 않는다 — 조회 조건에 userId 가 함께 들어간다.
        mockMvc.perform(post("/internal/auth/sessions/verify")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", newUser().toString())
                        .contentType("application/json")
                        .content("{\"sessionId\":\"" + sessionId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.sessionEpoch").value(0));

        // sessionId 없는 본문은 400 — 「확인하지 못했다」가 통과로 접히면 안 된다.
        mockMvc.perform(post("/internal/auth/sessions/verify")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    private static String settingsJson(boolean enabled) {
        return "{\"notificationEnabled\":" + enabled + ",\"soundEnabled\":true,"
                + "\"nightModeEnabled\":false,\"nightStartTime\":null,\"nightEndTime\":null}";
    }

    private static long versionOf(String json) {
        String marker = "\"version\":";
        int start = json.indexOf(marker) + marker.length();
        int end = start;
        while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '-')) {
            end++;
        }
        return Long.parseLong(json.substring(start, end));
    }

    private static String valueOf(String json, String field) {
        String marker = "\"" + field + "\":\"";
        int start = json.indexOf(marker) + marker.length();
        return json.substring(start, json.indexOf('"', start));
    }

}

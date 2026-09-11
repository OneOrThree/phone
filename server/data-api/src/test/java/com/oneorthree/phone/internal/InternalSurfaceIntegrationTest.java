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
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
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

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
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
    private static final String MIGRATION_TOKEN = "test-batch-admin-key";
    private static final String CAPABILITY_KEY = "ci-link-capability-key-for-tests-only";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("link.capability-key", () -> CAPABILITY_KEY);
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
                () -> "GET /internal/groups/*/invite-issue-context");
        registry.add("internal.api.callers.business.allow[6]",
                () -> "POST /internal/invite-links/claim-intents");
        registry.add("internal.api.callers.business.allow[7]",
                () -> "POST /internal/invite-links/claim-confirmations");
        registry.add("internal.api.callers.business.allow[8]",
                () -> "GET /internal/invite-links/claim-intents");
        registry.add("internal.api.callers.business.allow[9]",
                () -> "POST /internal/invite-links/claim-intents/*/lease");
        registry.add("internal.api.callers.business.allow[10]",
                () -> "POST /internal/invite-links/claim-intents/*/completed");
        registry.add("internal.api.callers.notification.token", () -> NOTI_TOKEN);
        registry.add("internal.api.callers.notification.allow[0]",
                () -> "GET /internal/users/*/result-ack");
        // 운영 이관 caller — 평소 프로파일에는 «없고» 이관 창에만 추가된다
        // (application-link-migration.yml). 여기서 같은 모양으로 세워 두 가지를 함께 잠근다:
        // ① 그 5경로가 실제 매핑과 일치하는가 ② Business 자격으로는 닿지 못하는가(㉱).
        registry.add("internal.api.callers.migration.token", () -> MIGRATION_TOKEN);
        registry.add("internal.api.callers.migration.allow[0]",
                () -> "POST /internal/migrations/*/invite-link-clicks/freeze");
        registry.add("internal.api.callers.migration.allow[1]",
                () -> "GET /internal/migrations/*/invite-link-clicks/manifest");
        registry.add("internal.api.callers.migration.allow[2]",
                () -> "GET /internal/migrations/*/invite-link-clicks/clicks");
        registry.add("internal.api.callers.migration.allow[3]",
                () -> "GET /internal/migrations/*/invite-links");
        registry.add("internal.api.callers.migration.allow[4]",
                () -> "POST /internal/migrations/*/invite-link-clicks/close-import");
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

    private static String capability(String slug, UUID groupId, UUID inviterId, long epoch, long expSeconds) {
        String json = "{\"slug\":\"" + slug + "\",\"groupId\":\"" + groupId + "\",\"inviterId\":\""
                + inviterId + "\",\"membershipEpoch\":\"" + epoch + "\",\"exp\":" + expSeconds + "}";
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(json.getBytes(StandardCharsets.UTF_8));
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(CAPABILITY_KEY.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return payload + "." + Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
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
    @DisplayName("기기 토큰 삭제는 Data 현행 토큰을 지우고 NOTI outbox 를 남긴다 — commandId 가 곧 eventId 다")
    void deviceTokenDeletionClearsCurrentTokenAndRecordsOutbox() throws Exception {
        UUID userId = newUser();
        tx().executeWithoutResult(status -> {
            User user = userRepository.findById(userId).orElseThrow();
            user.setDeviceToken("fcm-token-1");
            userRepository.save(user);
        });

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

        assertThat(userRepository.findById(userId).orElseThrow().getDeviceToken()).isNull();

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
        String commandId = commandIdOf(body);

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
    @DisplayName("발급 컨텍스트는 그룹·멤버십을 판정하고 기존 코드로 거절한다")
    void issueContextJudgesGroupAndMembership() throws Exception {
        UUID ownerId = newUser();
        UUID strangerId = newUser();
        Group group = newGroup(ownerId);

        mockMvc.perform(get("/internal/groups/{id}/invite-issue-context", group.getId())
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", ownerId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupActive").value(true))
                .andExpect(jsonPath("$.inviterActiveMember").value(true))
                // 발급 시점에는 두 값이 같다 — 갈리는 것은 폐기 명령뿐이다(ⓑ″).
                .andExpect(jsonPath("$.membershipEpoch").value(1))
                .andExpect(jsonPath("$.linkVersion").value(1))
                .andExpect(jsonPath("$.groupId").value(group.getId().toString()))
                .andExpect(jsonPath("$.inviterId").value(ownerId.toString()));

        mockMvc.perform(get("/internal/groups/{id}/invite-issue-context", group.getId())
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", strangerId.toString()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));

        mockMvc.perform(get("/internal/groups/{id}/invite-issue-context", UUID.randomUUID())
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", ownerId.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    @Test
    @DisplayName("claim 확정은 link.claimConfirmed outbox 를 남기고, 세대가 어긋나면 CLAIM_REVOKED 다")
    void claimConfirmationRecordsOutboxAndRejectsStaleEpoch() throws Exception {
        UUID ownerId = newUser();
        UUID claimerId = newUser();
        Group group = newGroup(ownerId);
        long exp = Instant.now().getEpochSecond() + 300;
        UUID claimId = UUID.randomUUID();

        String body = mockMvc.perform(post("/internal/invite-links/claim-confirmations")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", claimerId.toString())
                        .header("Idempotency-Key", "claim-1")
                        .contentType("application/json")
                        .content("{\"claimId\":\"" + claimId + "\",\"slug\":\"abc123\",\"capability\":\""
                                + capability("abc123", group.getId(), ownerId, 1L, exp) + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).contains("link.claimConfirmed:" + claimId);

        String replay = mockMvc.perform(post("/internal/invite-links/claim-confirmations")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", claimerId.toString())
                        .header("Idempotency-Key", "claim-1")
                        .contentType("application/json")
                        .content("{\"claimId\":\"" + claimId + "\",\"slug\":\"abc123\",\"capability\":\""
                                + capability("abc123", group.getId(), ownerId, 1L, exp + 60) + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(replay).isEqualTo(body);

        List<EventOutbox> envelopes = envelopesOf(claimerId, "link.claimConfirmed");
        assertThat(envelopes).hasSize(1);
        assertThat(envelopes.get(0).getParams())
                .containsEntry("groupId", group.getId().toString())
                .containsEntry("inviterId", ownerId.toString())
                .containsKey("proof");
        assertThat(eventOutboxDeliveryRepository.findByOutboxId(envelopes.get(0).getId()))
                .singleElement()
                .satisfies(delivery -> {
                    assertThat(delivery.getTarget()).isEqualTo(OutboxTarget.LINK);
                    assertThat(delivery.getEndpointKey()).isEqualTo("link.claimConfirmed");
                });

        // 발급 시점보다 오래된 세대의 자격은 거절한다 — 「최신으로 올려 주자」는 폐기된 초대를 되살린다.
        mockMvc.perform(post("/internal/invite-links/claim-confirmations")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", claimerId.toString())
                        .header("Idempotency-Key", "claim-2")
                        .contentType("application/json")
                        .content("{\"claimId\":\"" + UUID.randomUUID()
                                + "\",\"slug\":\"abc123\",\"capability\":\""
                                + capability("abc123", group.getId(), ownerId, 99L, exp) + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CLAIM_REVOKED"));

        // 셀프 초대 — 자기 링크를 자기가 타서 귀속받는 경로다. 링크 서버가 자격 자체를 안 주지만,
        // 이 경로의 신뢰 근거는 «서명»이고 서명은 «누가 들고 왔는지»를 담지 않는다.
        mockMvc.perform(post("/internal/invite-links/claim-confirmations")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", ownerId.toString())
                        .header("Idempotency-Key", "claim-self")
                        .contentType("application/json")
                        .content("{\"claimId\":\"" + UUID.randomUUID()
                                + "\",\"slug\":\"abc123\",\"capability\":\""
                                + capability("abc123", group.getId(), ownerId, 1L, exp) + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CLAIM_CAPABILITY_INVALID"));

        // 서명이 가리키는 링크와 요청의 slug 가 다르면 거절한다.
        mockMvc.perform(post("/internal/invite-links/claim-confirmations")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", claimerId.toString())
                        .header("Idempotency-Key", "claim-3")
                        .contentType("application/json")
                        .content("{\"claimId\":\"" + UUID.randomUUID()
                                + "\",\"slug\":\"other1\",\"capability\":\""
                                + capability("abc123", group.getId(), ownerId, 1L, exp) + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CLAIM_CAPABILITY_INVALID"));
    }

    @Test
    @DisplayName("claim 의도는 같은 (유저, slug) 로 한 행이고, lease→완료가 펜싱 토큰으로 닫힌다")
    void claimIntentQueueIsIdempotentAndFenced() throws Exception {
        UUID userId = newUser();

        String first = enqueueIntent(userId, "slug01");
        String second = enqueueIntent(userId, "slug01");
        assertThat(second).isEqualTo(first);

        String commandId = commandIdOf(first);

        String lease = mockMvc.perform(post("/internal/invite-links/claim-intents/{id}/lease", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .contentType("application/json")
                        .content("{\"leaseSeconds\":60}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leased").value(true))
                .andReturn().getResponse().getContentAsString();
        String leaseToken = valueOf(lease, "leaseToken");

        // 같은 항목을 남이 다시 집을 수 없다 — 실패가 아니라 「남이 잡고 있다」다.
        mockMvc.perform(post("/internal/invite-links/claim-intents/{id}/lease", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .contentType("application/json")
                        .content("{\"leaseSeconds\":60}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leased").value(false));

        // 낡은 토큰의 완료 보고는 409 — 200 으로 접으면 남이 진행 중인 재개가 「끝난 것」으로 덮인다.
        mockMvc.perform(post("/internal/invite-links/claim-intents/{id}/completed", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .contentType("application/json")
                        .content("{\"leaseToken\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CLAIM_INTENT_LEASE_STALE"));

        mockMvc.perform(post("/internal/invite-links/claim-intents/{id}/completed", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .contentType("application/json")
                        .content("{\"leaseToken\":\"" + leaseToken + "\"}"))
                .andExpect(status().isOk());
        // 같은 성공 토큰의 재시도는 200 — 재시도를 오류로 세면 실행자가 정상 완료를 실패로 기록한다.
        mockMvc.perform(post("/internal/invite-links/claim-intents/{id}/completed", commandId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .contentType("application/json")
                        .content("{\"leaseToken\":\"" + leaseToken + "\"}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("정지 링크 export는 두 표시정보 버전을 이름과 함께 고정한다")
    void frozenLinksPreserveDisplayVersionAtFreeze() throws Exception {
        UUID ownerId = newUser();
        Group group = newGroup(ownerId);
        String slug = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        tx().executeWithoutResult(state -> {
            groupInviteLinkRepository.save(new GroupInviteLink(slug, group.getId(), ownerId));
            groupMemberRepository.findByGroup(group).get(0).applyDisplaySnapshot(7L);
        });
        String migrationId = "display-" + UUID.randomUUID();
        mockMvc.perform(post("/internal/migrations/{id}/invite-link-clicks/freeze", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isOk());
        tx().executeWithoutResult(state ->
                groupMemberRepository.findByGroup(group).get(0).applyDisplaySnapshot(9L));
        mockMvc.perform(get("/internal/migrations/{id}/invite-links", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.source.slug == '" + slug
                        + "')].source.groupNameVersion").value(org.hamcrest.Matchers.contains("7")))
                .andExpect(jsonPath("$.items[?(@.source.slug == '" + slug
                        + "')].source.inviterNameVersion").value(org.hamcrest.Matchers.contains("7")));
    }

    @Test
    @DisplayName("이관 5경로는 운영 caller 에게만 열린다 — Business 자격으로는 닿지 못한다")
    void migrationSurfaceIsOperatorOnly() throws Exception {
        String migrationId = "mig-surface-" + UUID.randomUUID();

        // Business 자격으로는 freeze 조차 못 부른다 — 이관은 서비스 조합이 아니라 운영 절차다.
        mockMvc.perform(post("/internal/migrations/{id}/invite-link-clicks/freeze", migrationId)
                        .header("Authorization", "Bearer " + BIZ_TOKEN))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/internal/migrations/{id}/invite-link-clicks/freeze", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.expectedClicks").exists())
                .andExpect(jsonPath("$.expectedLinks").exists());

        // manifest 는 «스냅샷을 뜬 순간»의 값이라 요청마다 달라지지 않는다.
        mockMvc.perform(get("/internal/migrations/{id}/invite-link-clicks/manifest", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceChecksum").isNotEmpty())
                .andExpect(jsonPath("$.linkChecksum").isNotEmpty())
                .andExpect(jsonPath("$.importClosed").value(false));

        mockMvc.perform(get("/internal/migrations/{id}/invite-link-clicks/clicks", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());

        mockMvc.perform(get("/internal/migrations/{id}/invite-links", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());

        mockMvc.perform(post("/internal/migrations/{id}/invite-link-clicks/close-import", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isOk());

        // 닫힌 뒤에는 벌크 export 도 막는다 — 그 뒤의 import 는 이미 소진된 Neon 상태를 덮는 경로다.
        mockMvc.perform(get("/internal/migrations/{id}/invite-link-clicks/clicks", migrationId)
                        .header("Authorization", "Bearer " + MIGRATION_TOKEN))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IMPORT_CLOSED"));
    }

    @Test
    @DisplayName("허용목록 밖 경로는 caller 가 맞아도 403 이다 — 이름만 나누면 최소 권한이 서지 않는다")
    void allowlistIsEnforcedPerCallerOnRealBinding() throws Exception {
        UUID userId = newUser();

        // 알림 caller 에게만 열린 경로에 Business 자격으로 온다(㉱). 그 경로의 «구현»은 별도
        // 작업자 소유라 여기서 200 을 기대하지 않는다 — 검증 대상은 관문이 caller 를 가르는가다.
        mockMvc.perform(get("/internal/users/{id}/result-ack", userId)
                        .param("sessionId", UUID.randomUUID().toString())
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

    private String enqueueIntent(UUID userId, String slug) throws Exception {
        return mockMvc.perform(post("/internal/invite-links/claim-intents")
                        .header("Authorization", "Bearer " + BIZ_TOKEN)
                        .header("X-User-Id", userId.toString())
                        .header("Idempotency-Key", "intent-" + slug)
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static String settingsJson(boolean enabled) {
        return "{\"notificationEnabled\":" + enabled + ",\"soundEnabled\":true,"
                + "\"nightModeEnabled\":false,\"nightStartTime\":null,\"nightEndTime\":null}";
    }

    private static String commandIdOf(String json) {
        return valueOf(json, "commandId");
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

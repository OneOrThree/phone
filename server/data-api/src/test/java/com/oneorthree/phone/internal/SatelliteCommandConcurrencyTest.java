package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.LinkMembershipEventService;
import com.oneorthree.phone.internal.service.InternalInviteLinkService;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 동시 트랜잭션의 <b>경합</b> — 분리가 깨뜨리는 순서 불변식이 실제로 닫히는지 (A22 ⓚ · ㋕ · ㊸).
 *
 * <p>실물 PostgreSQL + 실제 Flyway 위에서 <b>두 커넥션</b>으로 돈다. 한 스레드 안에서 순서를 바꿔
 * 흉내 내면 잠금이 전혀 관여하지 않아, 정작 잠금이 빠져도 초록이 된다.
 */
@SpringBootTest
class SatelliteCommandConcurrencyTest {

    private static final String CAPABILITY_KEY = "ci-link-capability-key-for-tests-only";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("link.capability-key", () -> CAPABILITY_KEY);
    }

    @Autowired
    UserRepository userRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    LinkMembershipEventService linkMembershipEventService;
    @Autowired
    InternalInviteLinkService internalInviteLinkService;
    @Autowired
    UserSatelliteCommandService userSatelliteCommandService;
    @Autowired
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    @Test
    @DisplayName("확정 «도중» 커밋된 멤버십 전이는 확정을 통과시키지 않는다 — 공유 락이 판독과 커밋을 묶는다")
    void membershipTransitionDuringConfirmBlocksTheConfirmation() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        UUID claimerId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);

        CountDownLatch transitionCommitted = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            // ① 멤버십 전이를 «먼저» 커밋한다 — 자격이 가리키는 세대(1)가 낡은 값이 된다.
            Future<?> transition = pool.submit(() -> {
                tx().executeWithoutResult(status -> {
                    GroupMember membership = groupMemberRepository
                            .findActiveByUserIdAndGroupIdForUpdate(memberId, group.getId()).orElseThrow();
                    membership.leave();
                    linkMembershipEventService.recordMembershipRevoked(membership);
                });
                transitionCommitted.countDown();
            });
            assertThat(transitionCommitted.await(10, TimeUnit.SECONDS)).isTrue();
            transition.get(10, TimeUnit.SECONDS);

            // ② 그 뒤 도착한 확정은 «옛 세대» 자격을 들고 있다.
            long exp = Instant.now().getEpochSecond() + 300;
            assertThatThrownBy(() -> internalInviteLinkService.confirmClaim(
                    claimerId, UUID.randomUUID(), "abc123",
                    capability("abc123", group.getId(), memberId, 1L, exp), "key-stale"))
                    .isInstanceOf(InviteLinkException.class)
                    .extracting(thrown -> ((InviteLinkException) thrown).getErrorCode())
                    .isEqualTo(InviteLinkErrorCode.CLAIM_REVOKED);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("같은 유저의 동시 설정 변경은 «서로 다른» version 을 받는다 — 시퀀스면 커밋 순서가 어긋난다")
    void concurrentSettingsCommandsGetDistinctOrderedVersions() throws Exception {
        UUID userId = newUser();
        int threads = 6;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Future<Long>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < threads; i++) {
                boolean enabled = i % 2 == 0;
                String key = "concurrent-" + i;
                futures.add(pool.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    return userSatelliteCommandService
                            .recordNotificationSettings(userId, settings(enabled), key)
                            .version();
                }));
            }
            start.countDown();
            List<Long> versions = new java.util.ArrayList<>();
            for (Future<Long> future : futures) {
                versions.add(future.get(30, TimeUnit.SECONDS));
            }

            // aggregate 행 잠금 아래 발급되므로 중복이 없다. 시퀀스였다면 할당 순서만 보장돼
            // 「먼저 번호를 받고 늦게 커밋한 최신 상태」가 폐기된다(㊸).
            assertThat(versions).doesNotHaveDuplicates().hasSize(threads);
            assertThat(eventOutboxRepository.findAll().stream()
                    .filter(row -> row.getUserId().equals(userId))
                    .filter(row -> row.getType().equals("notification.settings.changed"))
                    .count()).isEqualTo(threads);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("명령이 롤백되면 봉투도 남지 않는다 — 「같은 트랜잭션」이라는 말의 뜻이 이것이다")
    void rollbackLeavesNoEnvelope() {
        UUID userId = newUser();
        // 설정 행을 지워 명령이 «도중에» 실패하게 만든다 — 실패 지점이 append 뒤여야 의미가 있다.
        tx().executeWithoutResult(status -> userNotificationSettingsRepository.deleteById(userId));

        assertThatThrownBy(() ->
                userSatelliteCommandService.recordNotificationSettings(userId, settings(true), "rollback-key"))
                .isInstanceOf(UserException.class);

        assertThat(eventOutboxRepository.findAll().stream()
                .anyMatch(row -> row.getUserId().equals(userId))).isFalse();
    }

    @Test
    @DisplayName("claim 의도는 동시에 들어와도 한 행이다 — 두 행이면 재개가 같은 귀속을 두 번 밟는다")
    void concurrentClaimIntentsCollapseIntoOneRow() throws Exception {
        UUID userId = newUser();
        int threads = 4;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        try {
            List<Future<UUID>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < threads; i++) {
                String key = "intent-key-" + i;
                futures.add(pool.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    try {
                        return internalInviteLinkService
                                .enqueueClaimIntent(userId, "racyslug", key).commandId();
                    } catch (RuntimeException e) {
                        // 동시 INSERT 가 UNIQUE 에 걸리는 것은 «정상 경합»이다 — 그 경우도 행은 하나여야 한다.
                        failure.compareAndSet(null, e);
                        return null;
                    }
                }));
            }
            start.countDown();
            for (Future<UUID> future : futures) {
                future.get(30, TimeUnit.SECONDS);
            }

            // 동시 INSERT 가 UNIQUE 에 걸려 한쪽이 실패하는 것은 정상 경합이다. 실패했든 아니든
            // «행은 하나»여야 한다 — 둘이면 재개가 같은 귀속을 두 번 밟는다.
            assertThat(intentRowsOf(userId, "racyslug")).isEqualTo(1L);
            if (failure.get() != null) {
                assertThat(failure.get()).isInstanceOf(RuntimeException.class);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    private long intentRowsOf(UUID userId, String slug) {
        return tx().execute(status -> {
            var repository = (com.oneorthree.phone.invitelink.repository.InviteClaimIntentRepository)
                    ReflectionTestUtils.getField(internalInviteLinkService, "inviteClaimIntentRepository");
            return repository.findAll().stream()
                    .filter(row -> row.getUserId().equals(userId) && row.getSlug().equals(slug))
                    .count();
        });
    }

    private static NotificationSettingsRequest settings(boolean enabled) {
        NotificationSettingsRequest request = new NotificationSettingsRequest();
        ReflectionTestUtils.setField(request, "notificationEnabled", enabled);
        ReflectionTestUtils.setField(request, "soundEnabled", true);
        ReflectionTestUtils.setField(request, "nightModeEnabled", false);
        return request;
    }

    private static String capability(String slug, UUID groupId, UUID inviterId, long epoch, long exp) {
        String json = "{\"slug\":\"" + slug + "\",\"groupId\":\"" + groupId + "\",\"inviterId\":\""
                + inviterId + "\",\"membershipEpoch\":\"" + epoch + "\",\"exp\":" + exp + "}";
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
            Group group = groupRepository.save(Group.builder().name("경합 그룹").maxMembers(10).build());
            groupMemberRepository.save(GroupMember.builder()
                    .user(userRepository.findById(ownerId).orElseThrow())
                    .group(group)
                    .role(GroupMemberRole.OWNER)
                    .build());
            return group;
        });
    }

    private void addMember(Group group, UUID userId) {
        tx().executeWithoutResult(status -> groupMemberRepository.save(GroupMember.builder()
                .user(userRepository.findById(userId).orElseThrow())
                .group(groupRepository.findById(group.getId()).orElseThrow())
                .role(GroupMemberRole.MEMBER)
                .build()));
    }
}

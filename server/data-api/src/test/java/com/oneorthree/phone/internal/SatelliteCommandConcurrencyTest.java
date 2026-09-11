package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.LinkMembershipEventService;
import com.oneorthree.phone.internal.dto.ClaimIntentLeaseResponse;
import com.oneorthree.phone.internal.service.InternalInviteLinkService;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.InviteClaimIntentRepository;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntent;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntentStatus;
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
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

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
    InviteClaimIntentRepository inviteClaimIntentRepository;
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
    @DisplayName("claim 의도는 동시에 들어와도 한 행이고 «아무도 실패하지 않는다» — 적재 실패는 곧 claim 실패다")
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
                        failure.compareAndSet(null, e);
                        return null;
                    }
                }));
            }
            start.countDown();
            List<UUID> acked = new java.util.ArrayList<>();
            for (Future<UUID> future : futures) {
                acked.add(future.get(30, TimeUnit.SECONDS));
            }

            // ⚠️ 「한쪽이 UNIQUE 로 터지는 것은 정상 경합」이 아니다. 이 적재는 202 의 «유일한 근거»라
            //    (A22 ㊄) 그 500 은 사용자에게 claim 실패로 보이고, 앱은 다음 로그인까지 재시도하지
            //    않으므로 그 귀속은 영영 사라진다. 그래서 유저 축 잠금 뒤 재조회로 패자를 접는다.
            assertThat(failure.get()).isNull();
            // 넷이 «같은» 의도를 받는다 — 응답이 갈리면 앱이 서로 다른 명령으로 본다.
            assertThat(acked).doesNotContainNull().containsOnly(acked.get(0));
            // 행은 하나다 — 둘이면 재개가 같은 귀속을 두 번 밟는다.
            assertThat(intentRowsOf(userId, "racyslug")).isEqualTo(1L);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("동시 선점은 «하나»만 성공한다 — 둘 다 true 를 받으면 실행자 둘이 같은 귀속을 민다")
    void concurrentLeasesElectExactlyOneWorker() throws Exception {
        UUID userId = newUser();
        UUID commandId = internalInviteLinkService
                .enqueueClaimIntent(userId, "leaseslug", "lease-race-key").commandId();

        ExecutorService pool = Executors.newSingleThreadExecutor();
        AtomicReference<Future<ClaimIntentLeaseResponse>> contender = new AtomicReference<>();
        try {
            // 테스트가 «직접» 트랜잭션을 열어 첫 선점을 그 안에서 부른다. 서비스가 REQUIRED 로 합류하므로
            // 행 잠금이 이 블록이 끝날 때까지 유지된다 — 두 커넥션의 시점을 손으로 겹칠 수 있는 유일한 방법이다
            // (latch 로 「동시에 출발」만 시키면 잠금이 빠져도 우연히 초록이 된다).
            tx().executeWithoutResult(status -> {
                ClaimIntentLeaseResponse first = internalInviteLinkService.leaseClaimIntent(commandId, 60);
                assertThat(first.leased()).isTrue();
                assertThat(first.leaseToken()).isNotNull();

                Future<ClaimIntentLeaseResponse> second =
                        pool.submit(() -> internalInviteLinkService.leaseClaimIntent(commandId, 60));
                contender.set(second);
                // ⚠️ 이 단정이 「잠갔는가」 그 자체다. 무락이면 둘째는 기다리지 않고 «리스 없음»인 옛 행을
                //    보고 곧바로 leased=true 를 받는다 — 그 순간 재개 실행자 둘이 같은 의도를 민다.
                assertThatThrownBy(() -> second.get(2, TimeUnit.SECONDS))
                        .isInstanceOf(TimeoutException.class);
            });

            // 첫 리스가 커밋된 뒤에야 깨어나고, «그 리스»를 보고 접힌다. 이건 오류가 아니라 사실이다.
            ClaimIntentLeaseResponse loser = contender.get().get(30, TimeUnit.SECONDS);
            assertThat(loser.leased()).isFalse();
            assertThat(loser.leaseToken()).isNull();
            assertThat(loser.leaseExpiresAt()).isNotNull();
            // 시도 수도 한 번만 는다 — 두 번 늘었다면 둘 다 선점에 성공했다는 뜻이다.
            assertThat(intentOf(commandId).getAttemptCount()).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("낡은 완료 보고는 그 사이의 재선점을 덮지 못한다 — 덮으면 아무도 밟지 않은 귀속이 사라진다")
    void staleCompletionCannotOverwriteAReLease() throws Exception {
        UUID userId = newUser();
        UUID commandId = internalInviteLinkService
                .enqueueClaimIntent(userId, "staleslug", "stale-race-key").commandId();

        // ① 리스가 «만료된» 옛 실행자를 만든다. holdsLease 는 만료를 보지 않으므로, 이 토큰은 재선점
        //    전까지는 여전히 「현재 리스」로 통과한다 — 낡은 보고가 위험한 이유가 이것이다.
        UUID staleToken = UUID.randomUUID();
        tx().executeWithoutResult(status -> inviteClaimIntentRepository.findById(commandId).orElseThrow()
                .lease("expired-worker", staleToken, Instant.now().minusSeconds(60)));

        ExecutorService pool = Executors.newSingleThreadExecutor();
        AtomicReference<Future<?>> lateReport = new AtomicReference<>();
        AtomicReference<UUID> freshToken = new AtomicReference<>();
        try {
            tx().executeWithoutResult(status -> {
                // ② 새 실행자가 재선점한다. 아직 커밋 전이라 행 잠금을 쥐고 있다.
                ClaimIntentLeaseResponse fresh = internalInviteLinkService.leaseClaimIntent(commandId, 60);
                assertThat(fresh.leased()).isTrue();
                freshToken.set(fresh.leaseToken());

                // ③ 그 틈에 옛 실행자의 완료 보고가 도착한다.
                Future<?> late = pool.submit(() -> {
                    internalInviteLinkService.completeClaimIntent(commandId, staleToken);
                    return null;
                });
                lateReport.set(late);
                // ⚠️ 무락이면 여기서 «끝나 버린다» — 재선점 전 행을 읽어 펜싱을 통과하고 의도를 닫는다.
                assertThatThrownBy(() -> late.get(2, TimeUnit.SECONDS)).isInstanceOf(TimeoutException.class);
            });

            // ④ 깨어난 뒤에는 재선점된 행을 본다 — 펜싱이 살아 409 다.
            Throwable thrown = catchThrowable(() -> lateReport.get().get(30, TimeUnit.SECONDS));
            assertThat(thrown).isInstanceOf(ExecutionException.class);
            assertThat(thrown.getCause()).isInstanceOf(InviteLinkException.class);
            assertThat(((InviteLinkException) thrown.getCause()).getErrorCode())
                    .isEqualTo(InviteLinkErrorCode.CLAIM_INTENT_LEASE_STALE);

            // ⑤ 의도는 여전히 PENDING 이고 리스는 «새» 실행자의 것이다 — 그가 계속 밟을 수 있어야 한다.
            InviteClaimIntent row = intentOf(commandId);
            assertThat(row.getStatus()).isEqualTo(InviteClaimIntentStatus.PENDING);
            assertThat(row.getLeaseToken()).isEqualTo(freshToken.get());
            assertThat(row.getCompletedByLeaseToken()).isNull();
            assertThat(row.getConsumedAt()).isNull();
        } finally {
            pool.shutdownNow();
        }
    }

    private long intentRowsOf(UUID userId, String slug) {
        return tx().execute(status -> inviteClaimIntentRepository.findAll().stream()
                .filter(row -> row.getUserId().equals(userId) && row.getSlug().equals(slug))
                .count());
    }

    /** 커밋된 «현재» 행 — 단정은 반드시 새 트랜잭션에서 다시 읽은 값으로 한다. */
    private InviteClaimIntent intentOf(UUID commandId) {
        return tx().execute(status -> inviteClaimIntentRepository.findById(commandId).orElseThrow());
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

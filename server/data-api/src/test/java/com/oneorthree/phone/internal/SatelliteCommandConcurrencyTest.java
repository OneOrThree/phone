package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.LinkMembershipEventService;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupService;
import com.oneorthree.phone.group.dto.UpdateGroupRequest;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import org.springframework.dao.OptimisticLockingFailureException;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.internal.dto.ClaimIntentLeaseResponse;
import com.oneorthree.phone.internal.service.InternalInviteLinkService;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.InviteClaimIntentRepository;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntent;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntentStatus;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
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

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import javax.sql.DataSource;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

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
import java.util.concurrent.atomic.AtomicInteger;
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
    UserQueryService userQueryService;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    LinkMembershipEventService linkMembershipEventService;
    @Autowired
    GroupMemberService groupMemberService;
    @Autowired
    GroupService groupService;
    @Autowired
    AggregateVersionRepository aggregateVersionRepository;
    @Autowired
    OutboxCommandPort outboxCommandPort;
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
    @Autowired
    DataSource dataSource;
    @PersistenceContext
    EntityManager entityManager;

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
    @DisplayName("강퇴 «도중» 들어온 이름 변경이 강퇴를 되살리지 않는다 — 표시 갱신의 전 컬럼 UPDATE 회귀")
    void displaySnapshotUpdateCannotResurrectAKickedMembership() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);

        ExecutorService pool = Executors.newSingleThreadExecutor();
        AtomicReference<Future<?>> renameRef = new AtomicReference<>();
        AtomicInteger renamePid = new AtomicInteger();
        CountDownLatch renameStarted = new CountDownLatch(1);
        try {
            // ① 강퇴 트랜잭션이 «커밋 전» 상태로 멤버십 행 잠금만 쥔다. 테스트가 직접
            //    트랜잭션을 열어야 두 커넥션의 시점을 겹칠 수 있다 — latch 로 동시에 출발만 시키면
            //    잠금이 빠져도 우연히 초록이 된다.
            tx().executeWithoutResult(status -> {
                int kickPid = backendPid();
                GroupMember target = groupMemberRepository
                        .findActiveByUserIdAndGroupIdForUpdate(memberId, group.getId()).orElseThrow();
                target.kick();

                // ② 그 사이 이름 변경이 들어온다. 대상 목록을 읽는 시점에는 강퇴가 아직 커밋 전이라
                //    이 멤버가 «활성»으로 보이고, 그 뒤 멤버 행 잠금에서 멈춘다.
                Future<?> rename = pool.submit(() -> {
                    tx().executeWithoutResult(inner -> {
                        renamePid.set(backendPid());
                        renameStarted.countDown();
                        Group renamed = groupRepository.findById(group.getId()).orElseThrow();
                        renamed.updateName("바뀐 이름");
                        linkMembershipEventService.recordGroupRenamed(renamed);
                    });
                    return null;
                });
                renameRef.set(rename);

                // ⚠️ 이 확인이 「정말로 그 창에 들어왔는가」다. 타임아웃만으로는 스레드가 아직 출발도
                //    안 했는지, 정말 잠금을 기다리는지 구분되지 않는다. 그래서 PostgreSQL 에게 직접
                //    묻는다 — 이름 변경 백엔드가 «Lock» 을 기다리고 있고 그 차단자가 이 강퇴 백엔드여야
                //    한다. 그래야 아래 단정이 「경합 창을 실제로 통과한 결과」가 된다.
                try {
                    assertThat(renameStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(renamePid.get(), kickPid);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(e);
                } catch (SQLException e) {
                    throw new IllegalStateException(e);
                }
                // 표시 변경이 aggregate부터 잠갔다면 여기서 ABBA 교착이 난다.
                // 멤버 → aggregate 순서가 같아야 강퇴를 커밋하고 표시 변경을 깨울 수 있다.
                linkMembershipEventService.recordMembershipRevoked(target);
                // 잠금을 쥔 채로는 아직 끝나지 않는다.
                assertThatThrownBy(() -> rename.get(1, TimeUnit.SECONDS))
                        .isInstanceOf(TimeoutException.class);
            });

            // ③ 강퇴가 커밋된 뒤 이름 변경이 깨어난다. 옛 구현은 여기서 «잠금 전에 로드한» 엔티티에
            //    더티 체킹을 걸어 전 컬럼 UPDATE 를 냈고, is_left·left_reason·membership_epoch 가
            //    강퇴 이전 값으로 되돌아갔다.
            renameRef.get().get(30, TimeUnit.SECONDS);

            GroupMember after = tx().execute(status -> groupMemberRepository
                    .findAnyByUserAndGroup(userRepository.findById(memberId).orElseThrow(),
                            groupRepository.findById(group.getId()).orElseThrow())
                    .orElseThrow());
            assertThat(after.isKicked()).isTrue();
            assertThat(after.getMembershipEpoch()).isEqualTo(2L);
            // 이름 변경 자체는 성공한다 — 「경합이면 전부 막는다」가 아니다.
            String renamedName = tx().execute(status ->
                    groupRepository.findById(group.getId()).orElseThrow().getName());
            assertThat(renamedName).isEqualTo("바뀐 이름");
            // 폐기된 링크에는 표시 갱신을 보내지 않는다(조건부 UPDATE 가 0행이면 명령도 없다).
            assertThat(renameEnvelopesFor(group.getId(), memberId)).isEmpty();
            // 남아 있는 방장에게는 그대로 나간다 — 「떠난 사람만 뺀다」다.
            assertThat(renameEnvelopesFor(group.getId(), ownerId)).hasSize(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("실제 강퇴와 이름 변경은 멤버십→aggregate 순서로 잠그고 이탈 상태를 보존한다")
    void actualKickMemberDoesNotDeadlockWithGroupRename() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        AggregateRef axis = AggregateRef.ofLinkMembership(group.getId(), memberId);
        // 이미 링크가 발급된 축이다. 첫 INSERT의 자동 flush가 멤버십 락을 우연히 먼저 잡는 경우를 배제한다.
        tx().executeWithoutResult(status -> outboxCommandPort.allocateVersion(axis));

        AtomicInteger kickPid = new AtomicInteger();
        AtomicInteger renamePid = new AtomicInteger();
        CountDownLatch kickStarted = new CountDownLatch(1);
        CountDownLatch renameStarted = new CountDownLatch(1);
        AtomicReference<Future<?>> kickRef = new AtomicReference<>();
        AtomicReference<Future<?>> renameRef = new AtomicReference<>();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            tx().executeWithoutResult(status -> {
                int blockerPid = backendPid();
                aggregateVersionRepository.findForUpdate(axis.type(), axis.id()).orElseThrow();
                kickRef.set(pool.submit(() -> tx().executeWithoutResult(kicking -> {
                    kickPid.set(backendPid());
                    kickStarted.countDown();
                    // 테스트가 멤버십 잠금을 대신 잡지 않는다. 서비스 진입부터 커밋까지 생산 경로다.
                    groupMemberService.kickMember(group.getId(), memberId, ownerId);
                })));
                try {
                    assertThat(kickStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(kickPid.get(), blockerPid);
                    renameRef.set(pool.submit(() -> tx().executeWithoutResult(renaming -> {
                        renamePid.set(backendPid());
                        renameStarted.countDown();
                        Group renamed = groupRepository.findById(group.getId()).orElseThrow();
                        renamed.updateName("실제 강퇴와 겹친 이름");
                        linkMembershipEventService.recordGroupRenamed(renamed);
                    })));
                    assertThat(renameStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(renamePid.get(), kickPid.get());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                } catch (SQLException sql) {
                    throw new IllegalStateException(sql);
                }
                // 수정 전에는 rename이 멤버십을, kick이 다음 aggregate 차례를 잡았다.
                // 이 잠금을 풀면 실제 PostgreSQL ABBA가 드러난다. 수정 후에는 rename만 멤버십에서 기다린다.
            });
            kickRef.get().get(30, TimeUnit.SECONDS);
            renameRef.get().get(30, TimeUnit.SECONDS);

            GroupMember after = tx().execute(status -> groupMemberRepository
                    .findAnyByUserAndGroup(userRepository.findById(memberId).orElseThrow(),
                            groupRepository.findById(group.getId()).orElseThrow()).orElseThrow());
            assertThat(after.isKicked()).isTrue();
            assertThat(after.getMembershipEpoch()).isEqualTo(2L);
            assertThat(renameEnvelopesFor(group.getId(), memberId)).isEmpty();
            assertThat(renameEnvelopesFor(group.getId(), ownerId)).hasSize(1);
            String renamedName = tx().execute(status -> groupRepository.findById(group.getId()).orElseThrow().getName());
            assertThat(renamedName).isEqualTo("실제 강퇴와 겹친 이름");
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("마지막 방장 그룹 탈퇴와 실제 이름 수정은 교착 없이 종료 상태를 보존한다")
    void actualSoloOwnerWithdrawalDoesNotDeadlockWithGroupUpdate() throws Exception {
        UUID ownerId = newUser();
        Group group = newGroup(ownerId);
        AggregateRef axis = AggregateRef.ofLinkMembership(group.getId(), ownerId);
        // 이미 링크가 발급된 축이다. 첫 INSERT의 자동 flush가 멤버십 락을 우연히 먼저 잡는 경우를 배제한다.
        tx().executeWithoutResult(status -> outboxCommandPort.allocateVersion(axis));

        AtomicInteger withdrawPid = new AtomicInteger();
        AtomicInteger renamePid = new AtomicInteger();
        CountDownLatch withdrawStarted = new CountDownLatch(1);
        CountDownLatch renameStarted = new CountDownLatch(1);
        AtomicReference<Future<?>> withdrawRef = new AtomicReference<>();
        AtomicReference<Future<?>> renameRef = new AtomicReference<>();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            tx().executeWithoutResult(status -> {
                int blockerPid = backendPid();
                aggregateVersionRepository.findForUpdate(axis.type(), axis.id()).orElseThrow();
                withdrawRef.set(pool.submit(() -> tx().executeWithoutResult(withdrawing -> {
                    withdrawPid.set(backendPid());
                    withdrawStarted.countDown();
                    // 테스트가 멤버십 잠금을 대신 잡지 않는다. 서비스 진입부터 커밋까지 생산 경로다.
                    groupMemberService.withdrawGroup(group.getId(), ownerId);
                })));
                try {
                    assertThat(withdrawStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(withdrawPid.get(), blockerPid);
                    renameRef.set(pool.submit(() -> catchThrowable(() -> tx().executeWithoutResult(renaming -> {
                        renamePid.set(backendPid());
                        renameStarted.countDown();
                        UpdateGroupRequest request = new UpdateGroupRequest();
                        ReflectionTestUtils.setField(request, "name", "그룹 종료와 겹친 이름");
                        groupService.updateGroup(group.getId(), ownerId, request);
                    }))));
                    assertThat(renameStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(renamePid.get(), withdrawPid.get());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                } catch (SQLException sql) {
                    throw new IllegalStateException(sql);
                }
                // 수정 전에는 rename이 groups 행을, withdraw가 멤버십 행을 쥐고 있다.
                // aggregate 차례를 열면 group.close flush와 rename fanout의 ABBA가 드러난다.
            });
            withdrawRef.get().get(30, TimeUnit.SECONDS);
            Object renameFailure = renameRef.get().get(30, TimeUnit.SECONDS);
            if (renameFailure != null) {
                // 종료가 먼저 커밋하면 이미 읽어 둔 Group @Version의 충돌은 정상이다.
                assertThat(renameFailure).isInstanceOf(OptimisticLockingFailureException.class);
            }

            GroupMember after = tx().execute(status -> groupMemberRepository
                    .findAnyByUserAndGroup(userRepository.findById(ownerId).orElseThrow(),
                            groupRepository.findById(group.getId()).orElseThrow()).orElseThrow());
            assertThat(after.isLeft()).isTrue();
            assertThat(after.isKicked()).isFalse();
            assertThat(after.getMembershipEpoch()).isEqualTo(2L);
            assertThat(renameEnvelopesFor(group.getId(), ownerId)).isEmpty();
            GroupStatus finalStatus = tx().execute(status -> groupRepository.findById(group.getId())
                    .orElseThrow().getStatus());
            assertThat(finalStatus).isEqualTo(GroupStatus.ENDED);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("계정 탈퇴의 실제 멤버십 정리도 이름 변경과 교착 없이 이탈 상태를 보존한다")
    void actualAccountWithdrawalDetachDoesNotDeadlockWithGroupRename() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        AggregateRef axis = AggregateRef.ofLinkMembership(group.getId(), memberId);
        // 이미 링크가 발급된 축이다. 첫 INSERT의 자동 flush가 멤버십 락을 우연히 먼저 잡는 경우를 배제한다.
        tx().executeWithoutResult(status -> outboxCommandPort.allocateVersion(axis));

        AtomicInteger detachPid = new AtomicInteger();
        AtomicInteger renamePid = new AtomicInteger();
        CountDownLatch detachStarted = new CountDownLatch(1);
        CountDownLatch renameStarted = new CountDownLatch(1);
        AtomicReference<Future<?>> detachRef = new AtomicReference<>();
        AtomicReference<Future<?>> renameRef = new AtomicReference<>();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            tx().executeWithoutResult(status -> {
                int blockerPid = backendPid();
                aggregateVersionRepository.findForUpdate(axis.type(), axis.id()).orElseThrow();
                detachRef.set(pool.submit(() -> tx().executeWithoutResult(detaching -> {
                    detachPid.set(backendPid());
                    detachStarted.countDown();
                    // 테스트가 멤버십 잠금을 대신 잡지 않는다. 서비스 진입부터 커밋까지 생산 경로다.
                    User withdrawingUser = userQueryService.getCallerForUpdate(memberId);
                    groupMemberService.detachWithdrawnUser(withdrawingUser);
                })));
                try {
                    assertThat(detachStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(detachPid.get(), blockerPid);
                    renameRef.set(pool.submit(() -> tx().executeWithoutResult(renaming -> {
                        renamePid.set(backendPid());
                        renameStarted.countDown();
                        Group renamed = groupRepository.findById(group.getId()).orElseThrow();
                        renamed.updateName("계정 탈퇴와 겹친 이름");
                        linkMembershipEventService.recordGroupRenamed(renamed);
                    })));
                    assertThat(renameStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(renamePid.get(), detachPid.get());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                } catch (SQLException sql) {
                    throw new IllegalStateException(sql);
                }
                // 수정 전에는 rename이 멤버십을, detach가 다음 aggregate 차례를 잡았다.
                // 이 잠금을 풀면 실제 PostgreSQL ABBA가 드러난다. 수정 후에는 rename만 멤버십에서 기다린다.
            });
            detachRef.get().get(30, TimeUnit.SECONDS);
            renameRef.get().get(30, TimeUnit.SECONDS);

            GroupMember after = tx().execute(status -> groupMemberRepository
                    .findAnyByUserAndGroup(userRepository.findById(memberId).orElseThrow(),
                            groupRepository.findById(group.getId()).orElseThrow()).orElseThrow());
            assertThat(after.isLeft()).isTrue();
            assertThat(after.isKicked()).isFalse();
            assertThat(after.getMembershipEpoch()).isEqualTo(2L);
            assertThat(renameEnvelopesFor(group.getId(), memberId)).isEmpty();
            assertThat(renameEnvelopesFor(group.getId(), ownerId)).hasSize(1);
            String renamedName = tx().execute(status -> groupRepository.findById(group.getId()).orElseThrow().getName());
            assertThat(renamedName).isEqualTo("계정 탈퇴와 겹친 이름");
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("이름 변경을 기다린 실제 강퇴는 이미 전진한 표시 스냅샷을 되돌리지 않는다")
    void actualKickPreservesTheSnapshotCommittedByAnEarlierRename() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        tx().executeWithoutResult(status -> outboxCommandPort.allocateVersion(
                AggregateRef.ofLinkMembership(group.getId(), memberId)));

        AtomicInteger kickPid = new AtomicInteger();
        CountDownLatch kickStarted = new CountDownLatch(1);
        AtomicReference<Future<?>> kickRef = new AtomicReference<>();
        AtomicReference<Long> renamedSnapshot = new AtomicReference<>();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            tx().executeWithoutResult(status -> {
                int renamePid = backendPid();
                Group renamed = groupRepository.findById(group.getId()).orElseThrow();
                renamed.updateName("먼저 바뀐 이름");
                linkMembershipEventService.recordGroupRenamed(renamed);
                renamedSnapshot.set(groupMemberRepository.findAnyByUserAndGroup(
                        userRepository.findById(memberId).orElseThrow(), renamed).orElseThrow().getSnapshotVersion());
                kickRef.set(pool.submit(() -> tx().executeWithoutResult(kicking -> {
                    kickPid.set(backendPid());
                    kickStarted.countDown();
                    groupMemberService.kickMember(group.getId(), memberId, ownerId);
                })));
                try {
                    assertThat(kickStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(kickPid.get(), renamePid);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                } catch (SQLException sql) {
                    throw new IllegalStateException(sql);
                }
            });
            kickRef.get().get(30, TimeUnit.SECONDS);
            GroupMember after = tx().execute(status -> groupMemberRepository
                    .findAnyByUserAndGroup(userRepository.findById(memberId).orElseThrow(),
                            groupRepository.findById(group.getId()).orElseThrow()).orElseThrow());
            assertThat(renamedSnapshot.get()).isGreaterThan(1L);
            assertThat(after.getSnapshotVersion()).isEqualTo(renamedSnapshot.get());
            assertThat(after.isKicked()).isTrue();
            assertThat(after.getMembershipEpoch()).isEqualTo(2L);
            assertThat(renameEnvelopesFor(group.getId(), memberId)).singleElement().satisfies(event ->
                    assertThat(((Number) event.getParams().get("snapshotVersion")).longValue())
                            .isEqualTo(renamedSnapshot.get()));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("이름 변경을 기다린 계정 탈퇴 정리는 이미 전진한 표시 스냅샷을 되돌리지 않는다")
    void actualDetachPreservesTheSnapshotCommittedByAnEarlierRename() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        tx().executeWithoutResult(status -> outboxCommandPort.allocateVersion(
                AggregateRef.ofLinkMembership(group.getId(), memberId)));

        AtomicInteger detachPid = new AtomicInteger();
        CountDownLatch detachStarted = new CountDownLatch(1);
        AtomicReference<Future<?>> detachRef = new AtomicReference<>();
        AtomicReference<Long> renamedSnapshot = new AtomicReference<>();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            tx().executeWithoutResult(status -> {
                int renamePid = backendPid();
                Group renamed = groupRepository.findById(group.getId()).orElseThrow();
                renamed.updateName("먼저 바뀐 이름");
                linkMembershipEventService.recordGroupRenamed(renamed);
                renamedSnapshot.set(groupMemberRepository.findAnyByUserAndGroup(
                        userRepository.findById(memberId).orElseThrow(), renamed).orElseThrow().getSnapshotVersion());
                detachRef.set(pool.submit(() -> tx().executeWithoutResult(detaching -> {
                    detachPid.set(backendPid());
                    detachStarted.countDown();
                    User withdrawingUser = userQueryService.getCallerForUpdate(memberId);
                    groupMemberService.detachWithdrawnUser(withdrawingUser);
                })));
                try {
                    assertThat(detachStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(detachPid.get(), renamePid);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                } catch (SQLException sql) {
                    throw new IllegalStateException(sql);
                }
            });
            detachRef.get().get(30, TimeUnit.SECONDS);
            GroupMember after = tx().execute(status -> groupMemberRepository
                    .findAnyByUserAndGroup(userRepository.findById(memberId).orElseThrow(),
                            groupRepository.findById(group.getId()).orElseThrow()).orElseThrow());
            assertThat(renamedSnapshot.get()).isGreaterThan(1L);
            assertThat(after.getSnapshotVersion()).isEqualTo(renamedSnapshot.get());
            assertThat(after.isLeft()).isTrue();
            assertThat(after.isKicked()).isFalse();
            assertThat(after.getMembershipEpoch()).isEqualTo(2L);
            assertThat(renameEnvelopesFor(group.getId(), memberId)).singleElement().satisfies(event ->
                    assertThat(((Number) event.getParams().get("snapshotVersion")).longValue())
                            .isEqualTo(renamedSnapshot.get()));
        } finally {
            pool.shutdownNow();
        }
    }

    /** 지금 트랜잭션이 쥐고 있는 커넥션의 PostgreSQL 백엔드 PID. */
    private int backendPid() {
        return ((Number) entityManager.createNativeQuery("SELECT pg_backend_pid()")
                .getSingleResult()).intValue();
    }

    /**
     * {@code blockedPid} 백엔드가 <b>실제로</b> 잠금을 기다리고 있고 그 차단자에 {@code blockerPid} 가
     * 들어 있을 때까지 기다린다 — 관측은 «제3의 커넥션»으로 한다(당사자 둘은 모두 대기 중이다).
     *
     * @throws AssertionError 제한 시간 안에 그 상태를 못 보면 경합 창을 통과하지 못한 것이다
     */
    private void awaitBlockedBy(int blockedPid, int blockerPid) throws SQLException, InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        String lastWait = null;
        List<Integer> lastBlockers = List.of();
        try (Connection observer = dataSource.getConnection();
                PreparedStatement query = observer.prepareStatement(
                        "SELECT wait_event_type, pg_blocking_pids(pid) FROM pg_stat_activity WHERE pid = ?")) {
            while (System.nanoTime() < deadline) {
                query.setInt(1, blockedPid);
                try (ResultSet row = query.executeQuery()) {
                    if (row.next()) {
                        lastWait = row.getString(1);
                        Array blockers = row.getArray(2);
                        lastBlockers = blockers == null ? List.of()
                                : List.of((Integer[]) blockers.getArray());
                        if ("Lock".equals(lastWait) && lastBlockers.contains(blockerPid)) {
                            return;
                        }
                    }
                }
                TimeUnit.MILLISECONDS.sleep(100);
            }
        }
        throw new AssertionError("이름 변경이 강퇴의 잠금 대기에 도달하지 않았다 — wait_event_type="
                + lastWait + " blocking_pids=" + lastBlockers + " (기대 차단자 " + blockerPid + ")");
    }

    /** {@code (groupId, inviterId)} 축으로 나간 그룹명 변경 명령. */
    private List<EventOutbox> renameEnvelopesFor(UUID groupId, UUID inviterId) {
        return tx().execute(status -> eventOutboxRepository.findAll().stream()
                .filter(row -> "group.renamed".equals(row.getType()))
                .filter(row -> (groupId + ":" + inviterId).equals(row.getAggregateId()))
                .toList());
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
    @DisplayName("«같은 키»의 동시 적재는 한 행이고 아무도 실패하지 않는다 — 적재 실패는 곧 claim 실패다")
    void concurrentClaimIntentsWithTheSameKeyCollapseIntoOneRow() throws Exception {
        UUID userId = newUser();
        // ⚠️ 네 스레드가 «같은» 키를 든다. 키가 갈리면 사건 키도 갈려 이 테스트는 경합을 만들지
        //    못한다 — 각자 자기 행을 조용히 만들고 끝나므로, 「한 행」 단정이 우연히 초록이 아니라
        //    아예 다른 것을 재게 된다.
        String sharedKey = "intent-shared-key";
        List<UUID> acked = enqueueConcurrently(userId, "racyslug", i -> sharedKey, 4);

        // 「한쪽이 UNIQUE 로 터지는 것은 정상 경합」이 아니다. 이 적재는 202 의 «유일한 근거»라
        // (A22 ㊄) 그 500 은 사용자에게 claim 실패로 보이고, 앱은 다음 로그인까지 재시도하지
        // 않으므로 그 귀속은 영영 사라진다. 그래서 유저 축 잠금 뒤 재조회로 패자를 접는다.
        //
        // 넷이 «같은» 의도를 받는다 — 응답이 갈리면 앱이 서로 다른 명령으로 본다.
        assertThat(acked).doesNotContainNull().containsOnly(acked.get(0));
        // 행은 하나다 — 둘이면 재개가 같은 귀속을 두 번 밟는다.
        assertThat(intentRowsOf(userId, "racyslug")).isEqualTo(1L);
    }

    @Test
    @DisplayName("«다른 키»면 같은 (유저, slug) 라도 각자 의도를 받는다 — 한 요청의 종결이 다른 요청을 삼키면 안 된다")
    void differentKeysGetTheirOwnIntentForTheSameUserAndSlug() throws Exception {
        UUID userId = newUser();
        List<UUID> acked = enqueueConcurrently(userId, "twinslug", i -> "intent-key-" + i, 2);

        // 응답이 갈려야 한다. 같으면 뒤 요청이 앞 요청의 «상태»를 물려받는다는 뜻이고, 앞 의도가
        // ABANDONED 로 끝나 있으면 뒤 요청은 재개가 잡지 못하는 종결 행을 받아 귀속이 사라진다.
        assertThat(acked).doesNotContainNull().doesNotHaveDuplicates();
        assertThat(intentRowsOf(userId, "twinslug")).isEqualTo(2L);
    }

    /**
     * 같은 {@code (유저, slug)} 로 여러 요청을 «동시에» 적재한다.
     *
     * @param userId  claim 주체
     * @param slug    초대 링크
     * @param keyOf   스레드 번호 → 멱등 키
     * @param threads 동시 요청 수
     * @return 각 요청이 받은 {@code commandId} — 실패는 여기서 바로 단정으로 걸러진다
     */
    private List<UUID> enqueueConcurrently(
            UUID userId, String slug, java.util.function.IntFunction<String> keyOf, int threads)
            throws Exception {

        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        try {
            List<Future<UUID>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < threads; i++) {
                String key = keyOf.apply(i);
                futures.add(pool.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    try {
                        return internalInviteLinkService
                                .enqueueClaimIntent(userId, slug, key).commandId();
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
            assertThat(failure.get()).isNull();
            return acked;
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

    @Test
    void replayCompletionPreservesTerminalCodeAndSuccessfulCompletionClearsRetryError() {
        UUID user = newUser();
        UUID rejected = internalInviteLinkService.enqueueClaimIntent(user, "gone", "terminal-key").commandId();
        ClaimIntentLeaseResponse rejectedLease = internalInviteLinkService.leaseClaimIntent(rejected, 60);
        internalInviteLinkService.completeClaimIntent(rejected, rejectedLease.leaseToken(), "SLUG_NOT_FOUND");
        internalInviteLinkService.completeClaimIntent(rejected, rejectedLease.leaseToken(), "SLUG_NOT_FOUND");
        assertThat(internalInviteLinkService.enqueueClaimIntent(user, "gone", "terminal-key").terminalCode())
                .isEqualTo("SLUG_NOT_FOUND");

        UUID recovered = internalInviteLinkService.enqueueClaimIntent(user, "live", "recovery-key").commandId();
        tx().executeWithoutResult(status -> inviteClaimIntentRepository.findById(recovered).orElseThrow()
                .releaseWithFailure(Instant.now().minusSeconds(1), "일시적인 상류 503"));
        assertThat(internalInviteLinkService.enqueueClaimIntent(user, "live", "recovery-key").terminalCode())
                .isNull();
        ClaimIntentLeaseResponse recoveredLease = internalInviteLinkService.leaseClaimIntent(recovered, 60);
        internalInviteLinkService.completeClaimIntent(recovered, recoveredLease.leaseToken());
        assertThat(internalInviteLinkService.enqueueClaimIntent(user, "live", "recovery-key").terminalCode())
                .isNull();
        assertThat(intentOf(recovered).getLastError()).isNull();
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

    /**
     * 마지막 1인이 나가 그룹이 자동 종료될 때 <b>{@code group.closed} 봉투가 실제로 만들어지는가</b>.
     *
     * <p>자동 종료 경로는 {@code leave()} 로 유일한 멤버를 비활성화한 «뒤» 종료 fan-out 을 부른다.
     * 그 fan-out 이 {@code isLeft=false} 로 대상을 조회하면, JPQL 실행 전에 변경이 flush 되므로
     * 목록이 <b>언제나 비어</b> 봉투가 한 건도 안 생긴다. 그러면 링크 서버에 그룹 tombstone 이 남지
     * 않아 <b>종료된 그룹의 slug 가 계속 랜딩·매치에 성공한다</b>.
     *
     * <p>목으로는 재현되지 않는다 — flush 시점이 관여하는 결함이라 실물 DB 와 실제 JPQL 이 필요하다.
     */
    @Test
    void groupClosedFansOutToTheMemberWhoJustLeft() {
        UUID ownerId = newUser();
        Group group = newGroup(ownerId);

        tx().executeWithoutResult(status -> {
            GroupMember membership = groupMemberRepository
                    .findActiveByUserIdAndGroupIdForUpdate(ownerId, group.getId()).orElseThrow();
            // 대상은 이탈 «전»에 포착해야 한다 — 운영 경로(GroupMemberService)와 같은 순서다.
            List<GroupMember> recipients = groupMemberRepository.findByGroup(membership.getGroup());
            membership.leave();
            membership.getGroup().close();
            linkMembershipEventService.recordGroupClosed(membership.getGroup(), recipients);
        });

        assertThat(eventOutboxRepository.findAll().stream()
                .filter(row -> "group.closed".equals(row.getType()))
                .filter(row -> ownerId.equals(row.getUserId()))
                .toList())
                .as("종료 사건이 없으면 죽은 그룹의 slug 가 계속 랜딩·매치에 성공한다")
                .hasSize(1);
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

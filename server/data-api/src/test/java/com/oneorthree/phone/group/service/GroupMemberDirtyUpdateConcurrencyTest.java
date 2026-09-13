package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.dto.UpdateGroupSettingsRequest;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.domain.GroupLeaveReason;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 멤버십 행의 <b>축 분리</b>가 더티 체킹에 뚫리지 않는지 (GROMO-1659 · A22 ㋡).
 *
 * <h2>무엇을 재는가</h2>
 * {@code group_members} 한 행에는 성격이 다른 값이 함께 산다 — 역할·공지 권한은 «요청자가 고치는
 * 값»이고, {@code snapshot_version}·{@code membership_epoch}·{@code transition_seq} 는 «다른
 * 트랜잭션이 잠금 아래 전진시키는 값»이다.
 *
 * <p>표시 스냅샷 전진({@link LinkMembershipEventService#recordGroupRenamed})은 컬럼 하나짜리
 * 조건부 UPDATE 라 자기 쪽은 안전하다. 그런데 <b>반대쪽</b>이 남아 있었다: 잠금 없이 로드한
 * 멤버십 엔티티(예 {@code transferOwner}·{@code updateGroupSettings} 의
 * {@code findByUserAndGroup})가 역할 하나만 고쳐도, 기본 더티 체킹은 <b>전 컬럼 UPDATE</b> 를 내
 * 그 사이 커밋된 {@code snapshot_version} 을 옛 값으로 되돌린다 — 링크 서버에는 새 버전이 이미
 * 나갔는데 코어 원장만 뒤로 감긴다. {@code GroupMember} 의 {@code @DynamicUpdate} 가 그 되감기를
 * 막는지 여기서 실물 PostgreSQL 두 커넥션으로 확인한다.
 *
 * <h2>무엇을 재지 «않는가»</h2>
 * 이 테스트가 닫는 것은 <b>「안 바꾼 컬럼을 덮지 않는다」</b> 하나뿐이다. 같은 컬럼을 둘이
 * 읽고-고쳐-쓰는 잃은 갱신, 잠금 순서(ABBA), 강퇴 부활 같은 축은 여기서 다루지 않는다 —
 * 그쪽은 {@code SatelliteCommandConcurrencyTest} 와 각 서비스의 행 잠금이 담당한다. 그래서
 * 아래 더티 쓰기는 일부러 <b>잠금 없는</b> 로드를 쓴다(잠금을 걸면 이름 변경이 그 잠금에서 멈춰
 * 이 축을 통과하지 못한다).
 *
 * <p>동기화는 sleep 이 아니라 <b>이름 변경 트랜잭션의 커밋 완료</b>다 — 그 완료를 기다린 «뒤»에
 * 바깥 트랜잭션이 실제 서비스를 호출하고 플러시하므로, 되감기가 일어난다면 반드시 일어난다.
 */
@SpringBootTest
class GroupMemberDirtyUpdateConcurrencyTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    UserRepository userRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupMemberService groupMemberService;
    @Autowired
    GroupService groupService;
    @Autowired
    LinkMembershipEventService linkMembershipEventService;
    @Autowired
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    PlatformTransactionManager transactionManager;
    @PersistenceContext
    EntityManager entityManager;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    @Test
    @DisplayName("방장 위임의 더티 플러시가 그 사이 전진한 표시 스냅샷을 되돌리지 않는다 — 실제 transferOwner 경로")
    void ownerTransferDoesNotRegressAConcurrentlyAdvancedSnapshot() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        UUID ownerRow = membershipRowId(group.getId(), ownerId);
        UUID memberRow = membershipRowId(group.getId(), memberId);

        // 위임은 요청자·대상 «두» 멤버십 행을 함께 더티로 만든다 — 되감기 후보도 둘이다.
        renameCommitsBetweenLoadAndWrite(group, "위임 도중 이름", () -> {
            entityManager.find(GroupMember.class, ownerRow);
            entityManager.find(GroupMember.class, memberRow);
        }, () -> groupMemberService.transferOwner(group.getId(), memberId, ownerId), ownerRow, memberRow);

        // 위임 자체는 그대로 반영된다 — 「경합이면 전부 막는다」가 아니다.
        assertThat(roleOf(group.getId(), ownerId)).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(roleOf(group.getId(), memberId)).isEqualTo(GroupMemberRole.OWNER);
        // 그리고 표시 버전은 «링크 서버에 나간 값» 그대로여야 한다.
        assertSnapshotMatchesSentCommand(group.getId(), ownerId);
        assertSnapshotMatchesSentCommand(group.getId(), memberId);
        assertMembershipAxisUntouched(group.getId(), ownerId);
        assertMembershipAxisUntouched(group.getId(), memberId);
    }

    @Test
    @DisplayName("공지 권한 변경의 더티 플러시가 그 사이 전진한 표시 스냅샷을 되돌리지 않는다 — 실제 updateGroupSettings 경로")
    void announcementGrantUpdateDoesNotRegressAConcurrentlyAdvancedSnapshot() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        UUID memberRow = membershipRowId(group.getId(), memberId);

        renameCommitsBetweenLoadAndWrite(group, "권한 변경 도중 이름",
                () -> entityManager.find(GroupMember.class, memberRow),
                () -> groupService.updateGroupSettings(group.getId(), ownerId,
                        new UpdateGroupSettingsRequest(
                                List.of(new UpdateGroupSettingsRequest.AnnouncementGrant(memberId, true)))),
                memberRow);

        assertThat(membershipOf(group.getId(), memberId).getAnnouncementPermission())
                .isEqualTo(GroupAnnouncementGrant.ALLOW);
        assertSnapshotMatchesSentCommand(group.getId(), memberId);
        assertMembershipAxisUntouched(group.getId(), memberId);
    }

    @Test
    @DisplayName("전이가 «정말» 일어난 쓰기는 그 컬럼을 그대로 쓴다 — @DynamicUpdate 가 변경을 삼키지 않는다")
    void aRealMembershipTransitionStillWritesItsOwnColumns() throws Exception {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        UUID memberRow = membershipRowId(group.getId(), memberId);

        // 강퇴+전이 기록은 is_left·left_reason·membership_epoch·transition_seq 를 «실제로» 바꾼다.
        //
        // 순서가 이 테스트의 전부다: ① 이름 변경 «전»에 엔티티를 낡은 상태로 로드해 두고,
        // ② 이름 변경이 표시 버전을 전진시켜 커밋한 뒤, ③ 그 낡은 엔티티에 강퇴 + 폐기 기록을 건다.
        // {@code recordMembershipRevoked} 를 ① 에 두면 그 안의 조회가 자동 플러시를 일으켜
        // 강퇴 UPDATE 가 먼저 행 잠금을 쥐고, 이름 변경이 그 잠금에서 멈춘 채 이 스레드가
        // {@code Future} 를 기다려 «교착»이 된다. 잠금 순서 축 자체는 실제 경로로
        // {@code SatelliteCommandConcurrencyTest} 가 닫아 두었다 — 여기서 재는 것은
        // 「바뀐 컬럼만 싣는가」다.
        AtomicReference<GroupMember> stale = new AtomicReference<>();
        renameCommitsBetweenLoadAndWrite(group, "강퇴 도중 이름",
                () -> stale.set(entityManager.find(GroupMember.class, memberRow)),
                () -> {
                    stale.get().kick();
                    linkMembershipEventService.recordMembershipRevoked(stale.get());
                },
                memberRow);

        GroupMember after = membershipOf(group.getId(), memberId);
        assertThat(after.isKicked()).isTrue();
        assertThat(after.getLeftReason()).isEqualTo(GroupLeaveReason.KICKED);
        assertThat(after.getMembershipEpoch()).isEqualTo(2L);
        assertThat(after.getTransitionSeq()).isPositive();
        // 안 바꾼 표시 버전은 그대로 — 바뀐 컬럼만 싣는다는 말이 양쪽으로 성립해야 한다.
        assertSnapshotMatchesSentCommand(group.getId(), memberId);
    }

    /**
     * 잠금 없이 멤버십 엔티티를 로드한 뒤, 다른 커넥션의 이름 변경이 표시 스냅샷을 전진시키고
     * 커밋할 때까지 기다린다. 그 후 실제 서비스가 같은 영속성 컨텍스트의 낡은 엔티티를 변경한다.
     *
     * <p>서비스가 먼저 실행되면 그룹·멤버십 잠금 또는 자동 플러시가 이름 변경을 막고, 바깥
     * 트랜잭션은 그 이름 변경의 완료를 기다리게 된다. 따라서 실제 서비스 호출은 이름 변경 커밋
     * 뒤에 둔다. 서비스의 생산 잠금은 그대로 사용하고, 변경 전 낡은 스냅샷 보유 여부를 단정해
     * {@code @DynamicUpdate} 가 안 바꾼 컬럼을 덮지 않는다는 회귀 의미를 유지한다.
     *
     * @param group       대상 그룹
     * @param newName     이름 변경 트랜잭션이 넣을 새 이름
     * @param staleLoader 이름 변경 전에 잠금 없이 낡은 스냅샷을 로드하는 동작
     * @param afterRename 이름 변경 커밋 뒤 실행할 실제 변경
     * @param staleRows   이름 변경이 커밋된 뒤에도 옛 값을 들고 있어야 하는 멤버십 행 PK 들
     */
    private void renameCommitsBetweenLoadAndWrite(Group group, String newName, Runnable staleLoader,
            Runnable afterRename, UUID... staleRows) {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            tx().executeWithoutResult(status -> {
                // ① 잠금 없이 낡은 멤버십을 로드한다. 실제 서비스 변경은 이름 변경 커밋 뒤다.
                staleLoader.run();

                // ② 그 사이 이름 변경이 «완전히» 커밋된다. 바깥 트랜잭션은 group_members 에 잠금을
                //    쥐고 있지 않으므로(평범한 SELECT) 이 트랜잭션은 막히지 않고 끝난다.
                Future<?> rename = pool.submit(() -> {
                    tx().executeWithoutResult(inner -> {
                        Group renamed = groupRepository.findById(group.getId()).orElseThrow();
                        renamed.updateName(newName);
                        linkMembershipEventService.recordGroupRenamed(renamed);
                    });
                    return null;
                });
                try {
                    // ⚠️ 장벽은 sleep 이 아니라 커밋 «완료»다. 여기서 기다리지 않으면 어느 쪽이
                    //    먼저 플러시되는지가 우연에 맡겨지고, 되감기가 있어도 초록이 될 수 있다.
                    rename.get(30, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("이름 변경을 기다리다 중단됐다", e);
                } catch (ExecutionException | TimeoutException e) {
                    throw new IllegalStateException("이름 변경 트랜잭션이 커밋되지 않았다", e);
                }
                // ③ 이 시점이 회귀의 «창»이다 — DB 는 전진한 값을, 이 트랜잭션의 엔티티는 옛 값을
                //    들고 있다. 이 확인이 없으면 아래 단정이 경합을 통과한 결과인지 알 수 없다.
                assertStaleSnapshot(staleRows);

                // ④ 낡은 엔티티에 «지금» 변경을 건다. 이름 변경은 이미 커밋돼 잠금을 놓았으므로
                //    여기서 자동 플러시가 나가도 아무도 기다리지 않는다.
                afterRename.run();
                // ⑤ 바깥 트랜잭션의 커밋(=남은 더티 플러시)은 이 블록을 나가면서 일어난다.
            });
        } finally {
            pool.shutdownNow();
        }
        // 이름 변경 자체도 성공해야 한다 — 그래야 위 단정이 「전진이 있었다」를 전제로 선다.
        assertThat(groupNameOf(group.getId())).isEqualTo(newName);
    }

    /**
     * 더티 쓰기가 <b>정말 낡은 스냅샷</b>을 들고 있는지 — 이름 변경이 커밋된 뒤에 부른다.
     * 영속성 컨텍스트에 이미 있는 인스턴스를 {@code find} 로 꺼내므로 조회도, 자동 플러시도
     * 일어나지 않는다(여기서 JPQL 을 쓰면 그 자동 플러시가 곧 되감기라 확인 자체가 사고가 된다).
     *
     * @param rowIds 낡은 값을 들고 있어야 하는 멤버십 행 PK 들
     */
    private void assertStaleSnapshot(UUID... rowIds) {
        for (UUID rowId : rowIds) {
            assertThat(entityManager.find(GroupMember.class, rowId).getSnapshotVersion())
                    .as("더티 쓰기가 쥔 스냅샷 버전(전진 전 값이어야 한다)")
                    .isZero();
        }
    }

    /**
     * 커밋된 {@code snapshot_version} 이 <b>링크 서버로 나간 명령의 값과 같은지</b>. 「0 이 아니다」
     * 보다 이 대조가 강하다 — 원장과 명령이 갈리면 늦게 온 relay 가 최신 이름을 덮을 수 있다.
     *
     * @param groupId   대상 그룹
     * @param inviterId 대상 멤버(= 링크 발급자 축)
     */
    private void assertSnapshotMatchesSentCommand(UUID groupId, UUID inviterId) {
        List<Long> sent = tx().execute(status -> eventOutboxRepository.findAll().stream()
                .filter(row -> LinkMembershipEventService.EVENT_GROUP_RENAMED.equals(row.getType()))
                .filter(row -> (groupId + ":" + inviterId).equals(row.getAggregateId()))
                .map(row -> ((Number) row.getParams().get("snapshotVersion")).longValue())
                .toList());
        assertThat(sent).as("이 멤버에게 나간 그룹명 변경 명령").hasSize(1);
        assertThat(membershipOf(groupId, inviterId).getSnapshotVersion())
                .as("커밋된 표시 버전은 링크 서버에 나간 값과 같아야 한다")
                .isEqualTo(sent.get(0).longValue());
    }

    /** 표시 축 쓰기가 멤버십 축을 건드리지 않았는지 — 전이가 없었으니 최초 값 그대로여야 한다. */
    private void assertMembershipAxisUntouched(UUID groupId, UUID userId) {
        GroupMember member = membershipOf(groupId, userId);
        assertThat(member.isLeft()).isFalse();
        assertThat(member.getLeftReason()).isNull();
        assertThat(member.getMembershipEpoch()).isEqualTo(1L);
        assertThat(member.getTransitionSeq()).isZero();
    }

    /** 커밋된 «현재» 행 — 단정은 반드시 새 트랜잭션에서 다시 읽은 값으로 한다. */
    private GroupMember membershipOf(UUID groupId, UUID userId) {
        return tx().execute(status -> groupMemberRepository
                .findAnyByUserAndGroup(userRepository.findById(userId).orElseThrow(),
                        groupRepository.findById(groupId).orElseThrow())
                .orElseThrow());
    }

    private GroupMemberRole roleOf(UUID groupId, UUID userId) {
        return membershipOf(groupId, userId).getRole();
    }

    private UUID membershipRowId(UUID groupId, UUID userId) {
        return membershipOf(groupId, userId).getId();
    }

    private String groupNameOf(UUID groupId) {
        return tx().execute(status -> groupRepository.findById(groupId).orElseThrow().getName());
    }

    /** 테스트마다 «새» 유저 — 다른 테스트의 그룹·멤버십과 섞이면 단정이 서로를 오염시킨다. */
    private UUID newUser() {
        return tx().execute(status -> userRepository.save(User.builder().build()).getId());
    }

    private Group newGroup(UUID ownerId) {
        return tx().execute(status -> {
            Group group = groupRepository.save(
                    Group.builder().name("더티 갱신 그룹").maxMembers(10).build());
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

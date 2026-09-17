package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.repository.GroupJoinCodeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.UserIslandContextRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 같은 사용자의 동시 섬 생성 두 건이 현재 섬 컨텍스트(user_island_contexts) 위에서 직렬화됨을 실 DB 로
 * 고정한다 (GROMO-1907).
 *
 * <p>{@link GroupService#createGroup} 은 users 행 배타 락({@code getCallerForUpdate}) 아래에서
 * {@link UserIslandContextLockService} 를 거쳐 컨텍스트 행을 잠그고 옮긴다. 두 트랜잭션이 실제로
 * 직렬화됐다면(동시가 아니라 «차례로») 컨텍스트 행의 낙관락 버전은 <b>정확히 2</b> 증가해야 한다 —
 * 직렬화가 깨지면 한쪽 갱신이 유실되어 버전이 1에 머물거나(락 없는 갱신), 반대로 컨텍스트 첫 생성
 * 경합에서 PK 중복으로 트랜잭션이 죽는다(users 행을 먼저 잠그지 않은 경우).
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@link GroupCreateWithdrawRaceIntegrationTest} 와
 * 같다 — 레이스는 별도 스레드의 별도 트랜잭션 커밋을 전제한다. 데이터는 {@code @AfterEach} 에서 직접
 * 지운다.
 */
class UserIslandContextRaceIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupService groupService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupJoinCodeRepository groupJoinCodeRepository;
    @Autowired
    UserIslandContextRepository userIslandContextRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("컨텍스트경합자").isGuest(false).build());
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).balance(100).build());
    }

    /**
     * 생성된 그룹은 id 를 이 테스트 메서드 안에서만 알 수 있어(레이스 결과) 본문 마지막에 직접 지운다 —
     * 여기서는 유저 축(컨텍스트·지갑·유저)만 정리한다.
     */
    @AfterEach
    void tearDown() {
        userIslandContextRepository.findById(user.getId()).ifPresent(userIslandContextRepository::delete);
        userWalletRepository.findById(user.getId()).ifPresent(userWalletRepository::delete);
        userRepository.delete(user);
    }

    @Test
    @DisplayName("같은 유저의 동시 섬 생성 2건 — 컨텍스트 버전이 정확히 2 증가하고 currentIslandId 는 둘 중 하나다")
    void concurrentCreateGroupSerializesOnUserIslandContext() throws Exception {
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        UUID[] createdGroupIds = new UUID[2];
        try {
            Future<?> firstCall = pool.submit(() -> {
                await(startTogether);
                CreateGroupResponse response = groupService.createGroup(user.getId(),
                        CreateGroupRequest.builder().name("경합섬A").maxMembers(5).build());
                createdGroupIds[0] = response.groupId();
            });
            Future<?> secondCall = pool.submit(() -> {
                await(startTogether);
                CreateGroupResponse response = groupService.createGroup(user.getId(),
                        CreateGroupRequest.builder().name("경합섬B").maxMembers(5).build());
                createdGroupIds[1] = response.groupId();
            });
            firstCall.get(30, TimeUnit.SECONDS);
            secondCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 둘 다 예외 없이 커밋됐다 — 배타 락이 컨텍스트 첫 생성 경합(PK 중복)까지 막았다는 뜻이다.
        assertThat(createdGroupIds[0]).isNotNull();
        assertThat(createdGroupIds[1]).isNotNull();
        Set<UUID> groupIds = Set.of(createdGroupIds[0], createdGroupIds[1]);

        // 두 그룹 모두 방장 멤버십과 함께 정상 생성됐다 — 기존 원자 생성 동작은 그대로다.
        for (UUID groupId : groupIds) {
            Group group = groupRepository.findById(groupId).orElseThrow();
            assertThat(groupMemberRepository.findAnyByUserAndGroup(user, group)).isPresent();
        }

        // 컨텍스트는 정확히 두 번 전이했다 — 유실 없이 차례로 커밋됐다는 증거다.
        UserIslandContext context = userIslandContextRepository.findById(user.getId()).orElseThrow();
        assertThat(context.getContextVersion()).isEqualTo(2L);
        assertThat(context.getCurrentIslandId()).isIn(groupIds);

        // tearDown 이 실제 생성된 그룹까지 지우도록 저장해 둔다.
        for (UUID groupId : groupIds) {
            groupJoinCodeRepository.findById(groupId).ifPresent(groupJoinCodeRepository::delete);
            groupRepository.findById(groupId).ifPresent(group -> {
                groupMemberRepository.findAnyByUserAndGroup(user, group)
                        .ifPresent(groupMemberRepository::delete);
                groupRepository.delete(group);
            });
        }
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}

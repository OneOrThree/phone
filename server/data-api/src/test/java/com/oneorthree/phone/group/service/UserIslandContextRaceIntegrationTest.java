package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 같은 사용자에 대한 {@link UserIslandContextLockService} 동시 호출 두 건이 현재 섬 컨텍스트
 * (user_island_contexts) 위에서 직렬화됨을 실 DB 로 고정한다 (GROMO-1907).
 *
 * <p>이 서비스는 아직 <b>호출부가 없다</b>({@code UserIslandContextLockService} 클래스 주석 참조) —
 * 현재 섬 이동 배선(가드·정리 포함)은 GROMO-1759 몫이다. 그래서 이 테스트는 {@code createGroup} 같은
 * 상위 경로를 거치지 않고 잠금 서비스 자체를 직접 두 트랜잭션에서 동시에 부른다.
 * {@code Propagation.MANDATORY}(바깥 트랜잭션 필수) 서비스라 {@link TransactionTemplate} 으로 각
 * 스레드마다 별도 트랜잭션 경계를 열어야 한다 — {@code PublicCommandService} 를 부르는 다른 통합
 * 테스트(예: {@code UserAggregateLockOrderIntegrationTest})와 같은 패턴이다.
 *
 * <p>두 호출이 서로 다른 섬 id 로 이동하고, 두 트랜잭션이 실제로 직렬화됐다면(동시가 아니라
 * «차례로») 컨텍스트 행의 낙관락 버전은 <b>정확히 2</b> 증가해야 한다 — 직렬화가 깨지면 한쪽 갱신이
 * 유실되어 버전이 1에 머문다.
 *
 * <p>{@code @Transactional} 을 클래스에 붙이지 않는 이유는 {@code GroupCreateWithdrawRaceIntegrationTest}
 * 와 같다 — 레이스는 별도 스레드의 별도 트랜잭션 커밋을 전제한다. 데이터는 {@code @AfterEach} 에서
 * 직접 지운다.
 */
class UserIslandContextRaceIntegrationTest extends IntegrationTestBase {

    @Autowired
    UserIslandContextLockService userIslandContextLockService;
    @Autowired
    UserIslandContextRepository userIslandContextRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    private User user;
    private UUID islandA;
    private UUID islandB;
    /** 레이스 전 컨텍스트 버전 — 두 전이가 모두 남았는지를 이 값 대비 +2 로 판정한다. */
    private long baselineContextVersion;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("컨텍스트경합자").isGuest(false).build());
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).balance(100).build());
        // 이동 대상 섬 두 개는 createGroup 을 거치지 않고 직접 만든다 — 이 테스트가 보는 것은
        // 잠금 서비스의 직렬화이지 그룹 생성 흐름이 아니다.
        islandA = groupRepository.save(Group.builder().name("경합섬A").maxMembers(5).build()).getId();
        islandB = groupRepository.save(Group.builder().name("경합섬B").maxMembers(5).build()).getId();
        // 컨텍스트 행을 미리 만들어 둔다. 없으면 첫 호출이 INSERT(@Version=0)라 두 전이의 증가분이
        // 1 이 되어, 「하나가 유실됐는지」를 버전으로 구분할 수 없다. 미리 있으면 둘 다 UPDATE 다.
        baselineContextVersion = userIslandContextRepository
                .save(UserIslandContext.newFor(user.getId())).getContextVersion();
    }

    @AfterEach
    void tearDown() {
        userIslandContextRepository.findById(user.getId()).ifPresent(userIslandContextRepository::delete);
        groupRepository.findById(islandA).ifPresent(groupRepository::delete);
        groupRepository.findById(islandB).ifPresent(groupRepository::delete);
        userWalletRepository.findById(user.getId()).ifPresent(userWalletRepository::delete);
        userRepository.delete(user);
    }

    @Test
    @DisplayName("같은 유저의 동시 lock().moveTo() 2건 — 컨텍스트 버전이 정확히 2 증가하고 currentIslandId 는 둘 중 하나다")
    void concurrentLockAndMoveToSerializesOnUserIslandContext() throws Exception {
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> firstCall = pool.submit(() -> {
                await(startTogether);
                tx().executeWithoutResult(status -> userIslandContextLockService.lock(user).moveTo(islandA));
            });
            Future<?> secondCall = pool.submit(() -> {
                await(startTogether);
                tx().executeWithoutResult(status -> userIslandContextLockService.lock(user).moveTo(islandB));
            });
            firstCall.get(30, TimeUnit.SECONDS);
            secondCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 컨텍스트는 정확히 두 번 전이했다 — 유실 없이 차례로 커밋됐다는 증거다.
        // 기준값을 setUp 에서 미리 만들어 두는 이유: 행이 없으면 첫 호출은 INSERT(@Version=0)이고
        // 두 번째만 UPDATE 라 증가분이 1이 된다. 그러면 「두 전이가 다 남았다」를 버전으로 셀 수 없다.
        // 미리 만들어 두면 두 호출이 모두 UPDATE 라 정확히 +2 여야 하고, 하나가 유실되면 +1 로 드러난다.
        UserIslandContext context = userIslandContextRepository.findById(user.getId()).orElseThrow();
        assertThat(context.getContextVersion()).isEqualTo(baselineContextVersion + 2);
        assertThat(context.getCurrentIslandId()).isIn(Set.of(islandA, islandB));
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}

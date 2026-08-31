package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 챌린지 행 배타 락이 <b>실제로</b> 걸리는지 확인한다 (Testcontainers PostgreSQL).
 *
 * <p>"OPEN 내기가 달린 챌린지는 삭제 불가" 가드는 검사와 {@code softDelete()} 사이에 내기 개설이
 * 끼어들면 뚫린다(PR #381 리뷰). 그 방어가 {@code SELECT … FOR UPDATE} 하나에 걸려 있어서, 애노테이션이
 * 조용히 무시되면 가드가 통째로 무력화된다 — 그래서 락 자체를 테스트한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는다({@link IntegrationTestBase}). 다른 커넥션이 그 행을
 * 볼 수 있어야 락 경합이 성립하므로 픽스처가 커밋돼 있어야 하고, 뒷정리는 직접 한다.
 */
class GroupChallengeLockIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    DataSource dataSource;

    private static final long TIMEOUT_SECONDS = 10;

    private Group group;
    private GroupChallenge challenge;

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").maxMembers(10).build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .status(GroupChallengeStatus.ACTIVE)
                .build());
    }

    @AfterEach
    void tearDown() {
        groupChallengeRepository.delete(challenge);
        groupRepository.delete(group);
    }

    @Test
    @DisplayName("findByIdAndGroupAndDeletedAtIsNullForUpdate — 챌린지 행을 잠가 다른 트랜잭션을 대기시킨다")
    void lockingQueryHoldsRowLock() throws Exception {
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<?> holder = pool.submit(() -> new TransactionTemplate(transactionManager).execute(status -> {
                assertThat(groupChallengeRepository
                        .findByIdAndGroupAndDeletedAtIsNullForUpdate(challenge.getId(), group)).isPresent();
                locked.countDown();
                awaitQuietly(release);
                return null;
            }));
            assertThat(locked.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isTrue();

            // NOWAIT 로 같은 행을 잠가 본다 — 락이 걸려 있으면 대기 없이 55P03 으로 튕긴다.
            // (운영 경로는 NOWAIT 가 아니라 대기하지만, 여기서는 "잠겨 있음"을 결정적으로 확인하려는 것이다)
            assertThatThrownBy(this::lockRowWithoutWaiting).isInstanceOf(SQLException.class);

            release.countDown();
            holder.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private void lockRowWithoutWaiting() throws SQLException {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "select id from group_challenges where id = ? for update nowait")) {
            statement.setObject(1, challenge.getId());
            statement.executeQuery().close();
        }
    }

    private static void awaitQuietly(CountDownLatch latch) {
        try {
            latch.await(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

package com.oneorthree.phone.group.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.UserIslandContextRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 컨텍스트 행의 첫 생성과 같은 트랜잭션의 이동이 한 flush 로 나간 뒤 flush 가 또 있어도 HHH000502 가 없고
 * created_at·버전이 그대로임을 실 DB 로 고정한다 (GROMO-2632).
 *
 * <p>경로: {@code lock()} 이 새 행을 {@code save} 하고 호출부가 곧바로 {@code moveTo} 하면 다음 flush 에 INSERT 와
 * UPDATE 가 함께 나간다 ({@code IslandMembershipService#create} 와 항해 정산의 첫 섬 생성이 이 모양이다).
 * UPDATE 의 상태 배열은 INSERT 가 createdAt 을 채우기 전에 만들어져 createdAt 이 null 이고, 그 배열이 스냅샷이 된다.
 * Hibernate 7 은 {@code @CreationTimestamp} 를 수정 불가로 취급하지만 {@code updatable=false} 가 없으면 dirty-check
 * 대상이라, 그다음 flush 가 null → 값을 «변경» 으로 보고 HHH000502 를 내며 바뀐 열이 없는 UPDATE 를 한 번 더 보낸다
 * (context_version 이 1 이 아니라 2 가 된다). {@code save} 가 merge 로 가는지(version 기본값 0)는 상관없다 — persist 로도 같다.
 * DB 의 created_at 은 UPDATE 에 실리지 않아 원래 값이 남는다.
 *
 * <p>flush 를 두 번 직접 부르는 이유: 실제 경로에서는 moveTo 뒤의 네이티브 쿼리(예: {@code INSERT ... ON CONFLICT})가
 * 그 flush 를 차례로 일으킨다. 커밋 flush 하나뿐이면 INSERT+UPDATE 가 한 번에 나가고 끝나 경고가 나지 않는다.
 */
class UserIslandContextFirstCreateIntegrationTest extends IntegrationTestBase {

    @Autowired
    UserIslandContextLockService userIslandContextLockService;
    @Autowired
    UserIslandContextRepository userIslandContextRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    JdbcTemplate jdbc;

    private User user;
    private UUID islandA;
    private UUID islandB;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private Timestamp createdAt() {
        return jdbc.queryForObject("select created_at from user_island_contexts where user_id = ?",
                Timestamp.class, user.getId());
    }

    private Long contextVersion() {
        return jdbc.queryForObject("select context_version from user_island_contexts where user_id = ?",
                Long.class, user.getId());
    }

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("첫컨텍스트").isGuest(false).build());
        islandA = groupRepository.save(Group.builder().name("첫섬A").maxMembers(5).build()).getId();
        islandB = groupRepository.save(Group.builder().name("첫섬B").maxMembers(5).build()).getId();
    }

    @AfterEach
    void tearDown() {
        userIslandContextRepository.findById(user.getId()).ifPresent(userIslandContextRepository::delete);
        groupRepository.findById(islandA).ifPresent(groupRepository::delete);
        groupRepository.findById(islandB).ifPresent(groupRepository::delete);
        userRepository.delete(user);
    }

    @Test
    @DisplayName("첫 컨텍스트 생성과 이동이 한 flush 로 나간 뒤 flush 가 또 있어도 불변 속성 경고 없이 created_at·버전이 유지된다")
    void firstCreateAndMoveInOneFlushThenAnotherFlush() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        Timestamp createdAtAfterFirstMove;
        Long versionAfterFirstMove;
        Timestamp createdAtAfterSecondMove;
        try {
            tx().executeWithoutResult(status -> {
                userIslandContextLockService.lock(user).moveTo(islandA);
                userIslandContextRepository.flush(); // INSERT 와 UPDATE 가 함께 나간다
                userIslandContextRepository.flush(); // 스냅샷과 비교하는 flush — 수정 전에는 여기서 경고하고 UPDATE 를 또 낸다
            });
            createdAtAfterFirstMove = createdAt();
            versionAfterFirstMove = contextVersion();

            tx().executeWithoutResult(status -> userIslandContextLockService.lock(user).moveTo(islandB));
            createdAtAfterSecondMove = createdAt();
        } finally {
            root.detachAppender(appender);
        }

        assertThat(appender.list).extracting(ILoggingEvent::getFormattedMessage)
                .noneMatch(message -> message.contains("HHH000502") && message.contains("UserIslandContext"));
        assertThat(createdAtAfterFirstMove).isNotNull();
        assertThat(createdAtAfterSecondMove).isEqualTo(createdAtAfterFirstMove);
        // 첫 소속은 INSERT(0) 뒤 이동 UPDATE 한 번이라 1 이다. 수정 전에는 두 번째 flush 가 UPDATE 를 한 번 더 내 2 였다.
        assertThat(versionAfterFirstMove).isEqualTo(1L);
    }
}

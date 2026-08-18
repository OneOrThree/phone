package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.support.TestPostgres;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * 커밋 이후 발송이 <b>커넥션을 두 개 동시에 물지 않는지</b>를 실증한다 (GROMO-1090, @codex 리뷰 P1).
 *
 * <p>지적의 요지: {@code afterCommit} 콜백은 바깥 트랜잭션의 JDBC 리소스가 정리되기 <b>전에</b>
 * 실행되므로, 여기서 {@code REQUIRES_NEW} 를 열면 요청 하나가 커넥션 두 개를 동시에 물고
 * 풀을 고갈시킬 수 있다는 것.
 *
 * <p>풀 크기를 <b>1</b> 로 묶고 같은 경로를 태워 판정한다. 발송이 요청 스레드에서 이어지면 새
 * 트랜잭션이 커넥션을 기다리다 타임아웃하고, 예외가 리스너에서 삼켜져 발송 기록이 남지 않는다 —
 * 이 브랜치에서 실제로 재현했다(<code>Connection is not available ... total=1, active=1</code>).
 * 리스너를 전용 executor 로 넘긴 뒤에는 바깥 커넥션이 먼저 반납돼 기록이 남는다.
 *
 * <p>커넥션 대기 타임아웃을 3초로 줄여, 회귀가 생기면 30초를 기다리지 않고 즉시 드러나게 한다.
 */
@SpringBootTest
class FriendPushConnectionUsageTest {

    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", TestPostgres.INSTANCE::getJdbcUrl);
        registry.add("spring.datasource.username", TestPostgres.INSTANCE::getUsername);
        registry.add("spring.datasource.password", TestPostgres.INSTANCE::getPassword);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 1);
        registry.add("spring.datasource.hikari.connection-timeout", () -> 3000);
    }

    @Autowired
    FriendService friendService;
    @Autowired
    FriendshipRepository friendshipRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    NotificationSentLogRepository notificationSentLogRepository;

    private final List<User> users = new ArrayList<>();

    @AfterEach
    void tearDown() {
        users.forEach(user -> friendshipRepository.deleteAll(
                friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(user, FriendshipStatus.PENDING)));
        notificationSentLogRepository.deleteAll(notificationSentLogRepository.findByTypeAndUserIdInSince(
                NotificationSentLog.TYPE_FRIEND_REQUEST, users.stream().map(User::getId).toList(), Instant.EPOCH));
        users.forEach(user -> userNotificationSettingsRepository.findById(user.getId())
                .ifPresent(userNotificationSettingsRepository::delete));
        userRepository.deleteAll(users);
        users.clear();
    }

    @Test
    @DisplayName("커넥션 풀이 1개여도 커밋 이후 발송이 완료된다 — 바깥 커넥션을 물고 있지 않다")
    void afterCommitSend_doesNotHoldASecondConnection() {
        User sender = pushableUser("보낸사람");
        User receiver = pushableUser("받는사람");

        friendService.createRequest(sender.getId(), receiver.getId());

        // 발송 완료는 DB 사후조건으로 직접 기다린다. executor 의 getTaskCount() 는 문서화된 근사치라
        // 워커가 큐에서 작업을 꺼낸 직후(락 획득 전) 창에서 과소 계수돼, completed 와 교차 비교하는
        // 폴링은 조기 탈출할 수 있다 — FriendPushNotificationIntegrationTest 의 GROMO-1228 플레이크와
        // 같은 결함 구조라 여기서도 카운터 폴링 자체를 걷어냈다. (풀 1개 컨텍스트라 10초 여유 유지)
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(notificationSentLogRepository.findByTypeAndUserIdInSince(
                        NotificationSentLog.TYPE_FRIEND_REQUEST, List.of(receiver.getId()), Instant.EPOCH))
                        .as("풀 크기 1에서도 발송 기록이 남아야 한다 — 남지 않으면 커넥션을 두 개 요구한 것이다")
                        .hasSize(1));
    }

    private User pushableUser(String nickname) {
        User user = userRepository.save(User.builder()
                .nickname(nickname + "-" + UUID.randomUUID())
                .isGuest(false)
                .deviceToken("token-" + UUID.randomUUID())
                .build());
        userNotificationSettingsRepository.save(UserNotificationSettings.builder()
                .userId(user.getId())
                .notificationEnabled(true)
                .soundEnabled(true)
                .nightModeEnabled(true)
                .nightStartTime(LocalTime.MIDNIGHT)
                .nightEndTime(LocalTime.MIDNIGHT)
                .build());
        users.add(user);
        return user;
    }
}

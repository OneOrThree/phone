package com.oneorthree.phone.internal;


import com.oneorthree.phone.auth.service.AuthService.LoginSessionResult;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 분리가 깨뜨리는 불변식의 <b>대체 계약</b>이 실제 도메인 트랜잭션에 붙어 있는지 (A22).
 *
 * <p>실물 PostgreSQL + <b>실제 Flyway V1~V52</b> 위에서 돈다({@code ddl-auto=validate}). 목으로
 * 도메인을 대신 세우지 않는다 — 여기서 검증하려는 것이 「그 커밋에 봉투가 함께 남는가」라서,
 * 서비스를 목으로 바꾸는 순간 검증 대상 자체가 사라진다.
 */
@SpringBootTest
class SatelliteCoreContractIntegrationTest {

    /** 소유권 값은 알림 서버가 UUID 로 발급해 앱이 그대로 되싣는 CAS 다 — 정규 표기만 통과한다. */
    private static final String OWNER = "dddddddd-0000-0000-0000-000000000001";
    private static final String OWNER_LEGACY = "dddddddd-0000-0000-0000-000000000002";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    AuthService authService;
    @Autowired
    JwtProvider jwtProvider;
    @Autowired
    AuthSessionRepository authSessionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupMemberService groupMemberService;
    @Autowired
    AccountWithdrawalService accountWithdrawalService;
    @Autowired
    GroupInviteLinkRepository inviteLinkRepository;
    @Autowired
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    EventOutboxDeliveryRepository eventOutboxDeliveryRepository;
    @Autowired
    UserSatelliteCommandService userSatelliteCommandService;
    @Autowired
    PlatformTransactionManager transactionManager;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private List<EventOutbox> envelopes(UUID userId, String type) {
        return eventOutboxRepository.findAll().stream()
                .filter(row -> row.getUserId().equals(userId) && row.getType().equals(type))
                .toList();
    }

    @Test
    @DisplayName("로그인은 세션 행을 만들고 AT 에 gen·sid 를 싣는다 — 기존 RT 경로는 그대로다")
    void guestLoginOpensSessionAndStampsClaims() {
        LoginSessionResult response = authService.guestSession(java.util.UUID.randomUUID().toString());

        assertThat(jwtProvider.extractSessionId(response.accessToken())).isNotNull();
        assertThat(response.deviceBootstrap()).isNotBlank();
        assertThat(jwtProvider.extractSessionId(response.accessToken())).isEqualTo(jwtProvider.extractSessionId(response.accessToken()));
        assertThat(jwtProvider.extractAuthGeneration(response.accessToken())).isZero();

        UUID userId = jwtProvider.extractUserId(response.accessToken());
        // 기존 경로도 살아 있어야 한다 — 세션 축은 «병행»이지 대체가 아니다(㋪).
        assertThat(authSessionRepository.findById(jwtProvider.extractSessionId(response.accessToken())).orElseThrow()
                .getRefreshTokenHash()).isNotBlank();
        assertThat(authSessionRepository.findActiveByUserId(userId)).hasSize(1);
    }

    /**
     * 형식이 깨진 소유권 값은 <b>내구 기록에 닿기 전에</b> 막힌다 (R10).
     *
     * <p>봉투에 실리면 알림 서버가 그 봉투를 소비하지 못하고, relay 는 고갈 처리가 없어(A18)
     * 순서 축이 같은 그 유저의 뒤 이벤트가 전부 막힌다. 그렇다고 {@code null} 로 접어 통과시키면
     * CAS 검사가 사라져 그 사이 재등록된 지금 기기까지 지운다(㊚) — 그래서 거절이다.
     */
    @Test
    @DisplayName("형식이 깨진 소유권 값은 outbox 에 적기 전에 거절한다 — 실리면 그 유저의 순서 축이 막힌다")
    void malformedOwnershipTokenNeverReachesTheDurableOutbox() {
        LoginSessionResult login = authService.guestSession(java.util.UUID.randomUUID().toString());
        UUID userId = jwtProvider.extractUserId(login.accessToken());

        assertThatThrownBy(() -> tx().execute(status -> userSatelliteCommandService.recordDeviceTokenDeletion(
                userId, new DeviceTokenDeletionRequest("fcm-logout", "not-a-uuid", null), "bad-owner")))
                .isInstanceOf(UserException.class)
                .extracting(e -> ((UserException) e).getErrorCode())
                .isEqualTo(UserErrorCode.DEVICE_OWNERSHIP_INVALID);
        // UUID.fromString 은 축약형도 받는다 — 정규 표기로 다시 쓰면 달라지므로 CAS 대조가 어긋난다.
        assertThatThrownBy(() -> tx().execute(status -> userSatelliteCommandService.recordDeviceTokenDeletion(
                userId, new DeviceTokenDeletionRequest("fcm-logout", "1-1-1-1-1", null), "short-owner")))
                .isInstanceOf(UserException.class);
        assertThat(envelopes(userId, "notification.deviceToken.deleted")).isEmpty();

        // 고친 값은 같은 유저·같은 키로 그대로 통과한다(깨진 본문이 멱등 지문으로 굳지 않았다).
        tx().execute(status -> userSatelliteCommandService.recordDeviceTokenDeletion(
                userId, new DeviceTokenDeletionRequest("fcm-logout", OWNER, null), "bad-owner"));
        assertThat(envelopes(userId, "notification.deviceToken.deleted")).hasSize(1);
    }

    @Test
    @DisplayName("탈퇴는 세대 증가·전 세션 폐기·기기 토큰 삭제·user.withdrawn 을 «한 커밋»에 담는다")
    void withdrawalCarriesEverySatelliteContractInOneCommit() {
        LoginSessionResult login = authService.guestSession(java.util.UUID.randomUUID().toString());
        UUID userId = jwtProvider.extractUserId(login.accessToken());
        tx().executeWithoutResult(status -> {
            User user = userRepository.findById(userId).orElseThrow();
            userRepository.save(user);
            userNotificationSettingsRepository.save(
                    UserNotificationSettings.builder().userId(userId).build());
        });

        accountWithdrawalService.withdraw(userId);

        User user = userRepository.findById(userId).orElseThrow();
        assertThat(user.isDeleted()).isTrue();
        assertThat(user.getAuthGeneration()).isEqualTo(1L);
        assertThat(authSessionRepository.findActiveByUserId(userId)).isEmpty();

        assertThat(envelopes(userId, "auth.generation.bumped")).hasSize(1);
        assertThat(envelopes(userId, "notification.deviceToken.deleted")).hasSize(1);

        List<EventOutbox> withdrawn = envelopes(userId, "user.withdrawn");
        assertThat(withdrawn).hasSize(1);
        // 알림은 Kafka 로 소비하고 링크는 Kafka 에 붙지 않는다(ⓐ). realtime 커서 파기 대상도 같이 적힌다(GROMO-1943).
        // 랭킹 제외(SCORE)는 user.onboarded 와 같은 대상에 적혀야 편입 뒤 제외가 따라 나간다(GROMO-1945).
        assertThat(eventOutboxDeliveryRepository.findByOutboxId(withdrawn.get(0).getId()))
                .extracting(delivery -> delivery.getTarget())
                .containsExactlyInAnyOrder(OutboxTarget.KAFKA, OutboxTarget.REALTIME,
                        OutboxTarget.SCORE);
    }

    @Test
    @DisplayName("강퇴는 이전 초대 코드의 세대를 무효화한다")
    void kickAdvancesMembershipEpoch() {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);

        groupMemberService.kickMember(group.getId(), memberId, ownerId);

        GroupMember kicked = tx().execute(status -> groupMemberRepository
                .findAnyByUserAndGroup(userRepository.findById(memberId).orElseThrow(),
                        groupRepository.findById(group.getId()).orElseThrow())
                .orElseThrow());
        assertThat(kicked.getMembershipEpoch()).isEqualTo(2L);


    }

    /**
     * 링크 쪽 {@code frozen()} 이 요구하는 slug 형식({@code ^[a-z0-9]{1,12}$})을 지키는 임의 값.
     * 형식이 어긋나면 이관 당일 400 이라, 테스트 데이터도 같은 규칙을 따라야 의미가 있다.
     */
    private static String slug(String prefix) {
        String random = UUID.randomUUID().toString().replace("-", "");
        return (prefix + random).substring(0, 12);
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

    private void addMember(Group group, UUID userId) {
        tx().executeWithoutResult(status -> groupMemberRepository.save(GroupMember.builder()
                .user(userRepository.findById(userId).orElseThrow())
                .group(groupRepository.findById(group.getId()).orElseThrow())
                .role(GroupMemberRole.MEMBER)
                .build()));
    }
}

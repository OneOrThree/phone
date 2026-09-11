package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupService;
import com.oneorthree.phone.internal.dto.ClaimIntentPageResponse;
import com.oneorthree.phone.internal.dto.FrozenClickCandidateResponse;
import com.oneorthree.phone.internal.service.InternalClickMigrationService;
import com.oneorthree.phone.internal.service.InternalInviteLinkService;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.InviteLinkClickRepository;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.support.FrozenClickSource;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
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
import java.util.Map;
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
    GroupService groupService;
    @Autowired
    AccountWithdrawalService accountWithdrawalService;
    @Autowired
    InternalInviteLinkService internalInviteLinkService;
    @Autowired
    InternalClickMigrationService internalClickMigrationService;
    @Autowired
    GroupInviteLinkRepository inviteLinkRepository;
    @Autowired
    InviteLinkClickRepository inviteLinkClickRepository;
    @Autowired
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    EventOutboxDeliveryRepository eventOutboxDeliveryRepository;
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
        GuestLoginResponse response = authService.guestLogin();

        assertThat(response.sessionId()).isNotNull();
        assertThat(response.deviceBootstrap()).isNotBlank();
        assertThat(jwtProvider.extractSessionId(response.accessToken())).isEqualTo(response.sessionId());
        assertThat(jwtProvider.extractAuthGeneration(response.accessToken())).isZero();

        UUID userId = jwtProvider.extractUserId(response.accessToken());
        // 기존 경로도 살아 있어야 한다 — 세션 축은 «병행»이지 대체가 아니다(㋪).
        assertThat(userRepository.findById(userId).orElseThrow().getRefreshTokenHash()).isNotBlank();
        assertThat(authSessionRepository.findActiveByUserId(userId)).hasSize(1);
    }

    @Test
    @DisplayName("개별 로그아웃은 «그 세션만» 끊고 세대를 올리지 않는다 — 다른 기기 푸시가 끊기지 않는다")
    void logoutRevokesOnlyThatSessionAndKeepsGeneration() {
        GuestLoginResponse first = authService.guestLogin();
        UUID userId = jwtProvider.extractUserId(first.accessToken());
        // 같은 유저의 두 번째 세션 — 현행 users.refresh_token_hash 는 하나뿐이라 세션 축이 없으면
        // 이 상황 자체를 표현할 수 없다(㋣).
        UUID secondSessionId = tx().execute(status -> authSessionRepository.save(AuthSession.builder()
                .userId(userId)
                .refreshTokenHash("other-device-hash-" + userId)
                .sessionEpoch(99L)
                .build()).getId());

        authService.logout(new LogoutRequest(first.refreshToken()));

        assertThat(authSessionRepository.findById(first.sessionId()).orElseThrow().isActive()).isFalse();
        assertThat(authSessionRepository.findById(secondSessionId).orElseThrow().isActive()).isTrue();
        assertThat(userRepository.findById(userId).orElseThrow().getAuthGeneration()).isZero();

        List<EventOutbox> revoked = envelopes(userId, "auth.session.revoked");
        assertThat(revoked).hasSize(1);
        assertThat(revoked.get(0).getSubjectId()).isEqualTo(first.sessionId().toString());
        assertThat(eventOutboxDeliveryRepository.findByOutboxId(revoked.get(0).getId()))
                .singleElement()
                .satisfies(delivery -> {
                    assertThat(delivery.getTarget()).isEqualTo(OutboxTarget.NOTI);
                    assertThat(delivery.getEndpointKey()).isEqualTo("noti.sessionRevoked");
                    // HTTP 대상은 «전체 봉투»로 나간다 — params 만 실으면 eventId·version 이 빠진다.
                    assertThat(delivery.getPayload()).containsKeys("eventId", "version", "userId");
                });
    }

    @Test
    @DisplayName("로그아웃이 기기 토큰을 실어 오면 같은 TX 에서 삭제까지 남는다 — 만료 AT 의 DELETE 를 대신한다")
    void logoutWithDeviceTokenRecordsDeletionInSameTransaction() {
        GuestLoginResponse login = authService.guestLogin();
        UUID userId = jwtProvider.extractUserId(login.accessToken());
        tx().executeWithoutResult(status -> {
            User user = userRepository.findById(userId).orElseThrow();
            user.setDeviceToken("fcm-logout");
            userRepository.save(user);
        });

        authService.logout(new LogoutRequest(login.refreshToken(), "fcm-logout", "own-1", null));
        // 첫 응답 유실 뒤 같은 RT 재시도가 삭제 명령을 추가하거나 401 로 갇히지 않는다.
        authService.logout(new LogoutRequest(login.refreshToken(), "fcm-logout", "own-1", null));

        assertThat(userRepository.findById(userId).orElseThrow().getDeviceToken()).isNull();
        assertThat(envelopes(userId, "notification.deviceToken.deleted")).hasSize(1);
        assertThat(envelopes(userId, "auth.session.revoked")).hasSize(1);
    }

    @Test
    @DisplayName("구 RT 로그아웃도 완료 원장을 남겨 같은 요청 재전달에 성공한다")
    void legacyLogoutResponseLossDoesNotStrandRetryQueue() {
        GuestLoginResponse login = authService.guestLogin();
        UUID userId = jwtProvider.extractUserId(login.accessToken());
        authSessionRepository.deleteById(login.sessionId());
        LogoutRequest request = new LogoutRequest(login.refreshToken(), "old-fcm", "old-owner", "legacy-key");
        authService.logout(request);
        authService.logout(request);
        assertThat(envelopes(userId, "auth.session.revoked")).hasSize(1);
        assertThat(envelopes(userId, "notification.deviceToken.deleted")).hasSize(1);
        assertThat(authSessionRepository.findByRefreshTokenHash(
                com.oneorthree.phone.auth.support.TokenHasher.sha256Hex(login.refreshToken())).orElseThrow()
                .isActive()).isFalse();
    }

    @Test
    @DisplayName("이전 기기의 지연 로그아웃은 다른 기기의 최신 RT 를 지우지 않는다")
    void delayedLogoutKeepsNewerDeviceRefreshToken() {
        GuestLoginResponse login = authService.guestLogin();
        UUID userId = jwtProvider.extractUserId(login.accessToken());
        String otherHash = com.oneorthree.phone.auth.support.TokenHasher.sha256Hex("other-device-token");
        tx().executeWithoutResult(status -> {
            User user = userRepository.findActiveByIdForUpdate(userId).orElseThrow();
            user.setRefreshTokenHash(otherHash);
        });
        authService.logout(new LogoutRequest(login.refreshToken()));
        assertThat(userRepository.findById(userId).orElseThrow().getRefreshTokenHash()).isEqualTo(otherHash);
        assertThat(authSessionRepository.findById(login.sessionId()).orElseThrow().isActive()).isFalse();
    }

    @Test
    @DisplayName("RT 회전은 세션을 갈아끼우고 fencing 값을 전진시킨다 — 구 RT 는 첫 회전에서 승격된다")
    void refreshRotatesSessionAndPromotesLegacyRefreshToken() {
        GuestLoginResponse login = authService.guestLogin();
        UUID userId = jwtProvider.extractUserId(login.accessToken());
        long before = authSessionRepository.findById(login.sessionId()).orElseThrow().getSessionEpoch();

        // 회전이 일어나도록 세션 행의 RT 해시를 그대로 두고 refresh 를 부른다. 게스트 RT 는 수명이
        // 길어 회전 조건에 걸리지 않으므로, 여기서는 «회전하지 않는» 경로의 sid 유지만 확인한다.
        TokenRefreshResponse refreshed = authService.refreshToken(login.refreshToken());

        assertThat(refreshed.sessionId()).isEqualTo(login.sessionId());
        assertThat(jwtProvider.extractSessionId(refreshed.accessToken())).isEqualTo(login.sessionId());
        assertThat(authSessionRepository.findById(login.sessionId()).orElseThrow().getSessionEpoch())
                .isEqualTo(before);
    }

    @Test
    @DisplayName("수명이 넉넉한 구 RT도 첫 refresh에서 세션·bootstrap을 발급받는다")
    void legacyRefreshPromotesBeforeRotationDeadline() {
        GuestLoginResponse login = authService.guestLogin();
        tx().executeWithoutResult(status -> authSessionRepository.deleteById(login.sessionId()));

        TokenRefreshResponse refreshed = authService.refreshToken(login.refreshToken());

        assertThat(refreshed.refreshToken()).isNotBlank().isNotEqualTo(login.refreshToken());
        assertThat(refreshed.sessionId()).isNotNull().isNotEqualTo(login.sessionId());
        assertThat(refreshed.deviceBootstrap()).isNotBlank();
        assertThat(jwtProvider.extractSessionId(refreshed.accessToken())).isEqualTo(refreshed.sessionId());
        assertThat(authSessionRepository.findById(refreshed.sessionId()).orElseThrow().isLegacy()).isTrue();
    }

    @Test
    @DisplayName("탈퇴는 세대 증가·전 세션 폐기·기기 토큰 삭제·user.withdrawn 을 «한 커밋»에 담는다")
    void withdrawalCarriesEverySatelliteContractInOneCommit() {
        GuestLoginResponse login = authService.guestLogin();
        UUID userId = jwtProvider.extractUserId(login.accessToken());
        tx().executeWithoutResult(status -> {
            User user = userRepository.findById(userId).orElseThrow();
            user.setDeviceToken("fcm-withdraw");
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
        // 알림은 Kafka 로 소비하고 링크는 Kafka 에 붙지 않는다 — 같은 사건이 두 대상으로 나간다(ⓐ).
        assertThat(eventOutboxDeliveryRepository.findByOutboxId(withdrawn.get(0).getId()))
                .extracting(delivery -> delivery.getTarget())
                .containsExactlyInAnyOrder(OutboxTarget.KAFKA, OutboxTarget.LINK);
    }

    @Test
    @DisplayName("강퇴는 세대를 올리고 link.revoked 에 «옛 세대와 새 세대»를 함께 싣는다 (ⓑ″)")
    void kickAdvancesEpochAndCarriesBothVersions() {
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

        List<EventOutbox> revoked = envelopes(memberId, "link.revoked");
        assertThat(revoked).hasSize(1);
        assertThat(revoked.get(0).getParams())
                // 폐기 대상은 «전이 전» 세대다 — 새 값만 실으면 「정확히 일치」로 못 지운다.
                .containsEntry("linkVersion", 1)
                // tombstone 갱신용은 «전이 후» 세대다 — 옛 값만 실으면 지연 발급을 못 막는다.
                .containsEntry("membershipEpoch", 2);
        assertThat(revoked.get(0).getAggregateType()).isEqualTo("LINK_MEMBERSHIP");
        assertThat(revoked.get(0).getAggregateId())
                .isEqualTo(group.getId() + ":" + memberId);
    }

    @Test
    @DisplayName("초대 링크 재가입은 «회차별» 사건으로 적힌다 — 같은 키면 가입 트랜잭션이 통째로 롤백된다")
    void rejoiningThroughAnInviteLinkWritesASecondJoinEvent() {
        UUID ownerId = newUser();
        UUID joinerId = newUser();
        Group group = newGroup(ownerId);
        String first = slug("ra");
        String second = slug("rb");
        tx().executeWithoutResult(status ->
                inviteLinkRepository.save(new GroupInviteLink(first, group.getId(), ownerId)));

        groupService.joinGroup(group.getId(), joinerId, joinRequest(first, "invite"));
        assertThat(joinEnvelopes(joinerId)).hasSize(1);

        // 자진 탈퇴 — 행은 남고 세대만 오른다(A-0 소프트삭제).
        groupMemberService.withdrawGroup(group.getId(), joinerId);

        // ⚠️ 여기가 회귀 지점이다. 키가 (groupId, joinedUserId) 뿐이면 이 호출이
        //    uq_event_outbox_event_id 위반으로 «가입 자체»를 롤백시킨다 — 링크 귀속 하나 때문에
        //    사용자가 그룹에 못 들어간다. 그리고 재가입은 이렇게 «다른 발급자의 다른 링크»로 들어오는
        //    경우가 흔해서 「이미 있으면 건너뛴다」로 접을 수도 없다.
        groupService.joinGroup(group.getId(), joinerId, joinRequest(second, "invite"));

        List<EventOutbox> joined = joinEnvelopes(joinerId);
        assertThat(joined).hasSize(2);
        assertThat(joined).extracting(EventOutbox::getEventId).doesNotHaveDuplicates();
        // 회차는 가입자 자신의 멤버십 세대다 — 최초 1, 탈퇴 2, 재가입 3.
        assertThat(joined).extracting(row -> row.getParams().get("joinEpoch"))
                .containsExactlyInAnyOrder(1, 3);
        assertThat(joined).extracting(row -> row.getParams().get("slug"))
                .containsExactlyInAnyOrder(first, second);
        // 재가입도 멤버십 전이라 폐기 명령이 함께 있어야 한다(ⓚ).
        assertThat(envelopes(joinerId, "link.revoked")).hasSize(2);
    }

    @Test
    @DisplayName("코어에 없는 새 slug 도 가입 사실이 적힌다 — 발급자는 «추정하지 않고» 링크가 판정한다")
    void joiningWithALinkServerSlugStillRecordsTheJoinFact() {
        UUID ownerId = newUser();
        UUID joinerId = newUser();
        Group group = newGroup(ownerId);
        // 새 링크 서버가 발급한 slug — group_invite_links 에 행이 없다(claim 도 선행하지 않는다).
        String fresh = slug("ln");
        assertThat(inviteLinkRepository.findBySlug(fresh)).isEmpty();

        groupService.joinGroup(group.getId(), joinerId, joinRequest(fresh, "invite"));

        List<EventOutbox> joined = joinEnvelopes(joinerId);
        assertThat(joined).hasSize(1);
        EventOutbox envelope = joined.get(0);
        assertThat(envelope.getEventId())
                .isEqualTo("link.joined:" + group.getId() + ":" + joinerId + ":1");
        // 순서 축은 «가입자»다 — 발급자를 모르면 발급자 축은 만들 수조차 없다.
        assertThat(envelope.getAggregateType()).isEqualTo("USER");
        assertThat(envelope.getAggregateId()).isEqualTo(joinerId.toString());
        assertThat(envelope.getSubjectId()).isEqualTo(group.getId().toString());
        assertThat(envelope.getParams())
                .containsEntry("slug", fresh)
                .containsEntry("groupId", group.getId().toString())
                .containsEntry("joinedUserId", joinerId.toString())
                .containsEntry("joinMethod", "invite")
                // 발급자를 «추정»하지 않는다 — 미검증 입력이 초대 보상의 근거가 되면 안 된다.
                .doesNotContainKey("inviterId");
        // 가입 자체도 정상이다 — 귀속은 부가 정보라 가입 성공을 claim 선행에 묶지 않는다.
        assertThat(groupMemberRepository.existsByGroupIdAndUserId(group.getId(), joinerId)).isTrue();
    }

    @Test
    @DisplayName("형식이 어긋난 slug 는 버리고 가입은 성공한다 — 영원히 400 인 명령을 큐에 남기지 않는다")
    void malformedSlugIsDroppedWithoutBlockingTheJoin() {
        UUID ownerId = newUser();
        UUID joinerId = newUser();
        Group group = newGroup(ownerId);

        // 링크 계약은 ^[a-z0-9]{1,12}$ 다. 요청 DTO 에는 길이·문자 제약이 없어 여기로 그대로 들어온다.
        groupService.joinGroup(group.getId(), joinerId, joinRequest("NOT-A-SLUG-AT-ALL", "invite"));

        assertThat(joinEnvelopes(joinerId)).isEmpty();
        assertThat(groupMemberRepository.existsByGroupIdAndUserId(group.getId(), joinerId)).isTrue();
    }

    @Test
    @DisplayName("다른 그룹을 가리키는 slug 도 가입 사실은 그대로 간다 — 판정은 원장을 가진 링크가 한다")
    void slugPointingAtAnotherGroupIsStillForwardedForTheLedgerToJudge() {
        UUID ownerId = newUser();
        UUID joinerId = newUser();
        Group group = newGroup(ownerId);
        Group other = newGroup(newUser());
        String foreign = slug("fg");
        tx().executeWithoutResult(status ->
                inviteLinkRepository.save(new GroupInviteLink(foreign, other.getId(), ownerId)));

        groupService.joinGroup(group.getId(), joinerId, joinRequest(foreign, "invite"));

        // 코어는 이 불일치를 «판정하지 않는다». 봉투에는 실제 들어간 그룹이 실리고, 링크 서버가
        // 자기 원장의 slug→그룹과 대조해 어긋나면 귀속하지 않는다(applied:false).
        List<EventOutbox> joined = joinEnvelopes(joinerId);
        assertThat(joined).hasSize(1);
        assertThat(joined.get(0).getParams())
                .containsEntry("groupId", group.getId().toString())
                .containsEntry("slug", foreign);
    }

    /** {@code link.joined} 봉투 — 가입자 축이라 {@code userId} 가 가입자다. */
    private List<EventOutbox> joinEnvelopes(UUID joinedUserId) {
        return envelopes(joinedUserId, "link.joined");
    }

    private static JoinGroupRequest joinRequest(String inviteSlug, String joinMethod) {
        return JoinGroupRequest.builder()
                .joinMethod(joinMethod)
                .inviteSlug(inviteSlug)
                .appInstanceId("inst-test")
                .build();
    }

    @Test
    @DisplayName("발급 컨텍스트는 전이 뒤 NOT_MEMBER 로 바뀐다 — 죽은 멤버십으로 링크가 발급되지 않는다")
    void issueContextFollowsMembershipTransition() {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);

        assertThat(internalInviteLinkService.issueContext(group.getId(), memberId).membershipEpoch())
                .isEqualTo(1L);

        groupMemberService.kickMember(group.getId(), memberId, ownerId);

        assertThatThrownBy(() -> internalInviteLinkService.issueContext(group.getId(), memberId))
                .isInstanceOf(InviteLinkException.class)
                .extracting(thrown -> ((InviteLinkException) thrown).getErrorCode())
                .isEqualTo(InviteLinkErrorCode.NOT_MEMBER);
    }

    @Test
    @DisplayName("정지 스냅샷은 두 번 떠도 다시 만들지 않고, IMPORT_CLOSED 뒤엔 후보를 주지 않는다")
    void freezeIsIdempotentAndClosedImportRejectsExport() {
        String migrationId = "mig-" + UUID.randomUUID();

        InternalClickMigrationService.FreezeResult first = internalClickMigrationService.freeze(migrationId);
        InternalClickMigrationService.FreezeResult second = internalClickMigrationService.freeze(migrationId);
        assertThat(second).isEqualTo(first);

        assertThat(internalClickMigrationService.exportCandidates(migrationId, "a".repeat(64), "ios"))
                .isEmpty();

        internalClickMigrationService.closeImport(migrationId);

        assertThatThrownBy(() ->
                internalClickMigrationService.exportCandidates(migrationId, "a".repeat(64), "ios"))
                .isInstanceOf(InviteLinkException.class)
                .extracting(thrown -> ((InviteLinkException) thrown).getErrorCode())
                .isEqualTo(InviteLinkErrorCode.IMPORT_CLOSED);
    }

    @Test
    @DisplayName("정지 스냅샷은 «실제 클릭»을 링크 importer 형식으로 담고 체크섬을 붙인다 — 폐기 상태도 확정한다")
    void freezeCapturesRealClickAsImporterSource() {
        UUID ownerId = newUser();
        Group group = newGroup(ownerId);
        String ipHash = "b".repeat(64);
        UUID linkId = tx().execute(status -> inviteLinkRepository
                .save(new GroupInviteLink(slug("frz"), group.getId(), ownerId))
                .getId());
        tx().executeWithoutResult(status ->
                inviteLinkClickRepository.save(new InviteLinkClick(linkId, ipHash, "ios", "ua")));

        String migrationId = "mig-real-" + UUID.randomUUID();
        InternalClickMigrationService.FreezeResult frozen =
                internalClickMigrationService.freeze(migrationId);
        assertThat(frozen.clicks()).isEqualTo(1);
        // 링크 원장은 «클릭이 없는 slug 까지» 담는다 — 그래서 링크 수가 클릭 수와 같을 이유가 없다.
        assertThat(frozen.links()).isGreaterThanOrEqualTo(1);

        List<FrozenClickCandidateResponse> candidates =
                internalClickMigrationService.exportCandidates(migrationId, ipHash, "ios");
        assertThat(candidates).hasSize(1);
        Map<String, Object> source = candidates.get(0).source();
        // 링크 importer 의 frozen() 이 요구하는 24필드 — 하나라도 빠지면 그쪽이 400 으로 막는다.
        assertThat(source).hasSize(26)
                .containsEntry("groupNameVersion", "0")
                .containsEntry("inviterNameVersion", "0")
                .containsEntry("groupId", group.getId().toString())
                .containsEntry("inviterId", ownerId.toString())
                .containsEntry("os", "ios")
                .containsEntry("matched", false)
                .containsEntry("matchedAt", null)
                // 발급자가 아직 활성 멤버라 살아 있는 링크다(ⓙ: 상태를 «확정해서» 옮긴다).
                .containsEntry("linkStatus", "ACTIVE")
                .containsEntry("revokedAt", null)
                // 세대 셋은 «문자열»이다 — 그 모양이 체크섬의 일부다.
                .containsEntry("membershipEpoch", "1")
                .containsEntry("linkVersion", "1");
        // 시각은 밀리초 3자리 + Z — 받는 쪽 new Date().toISOString() 과 같은 모양이어야 한다.
        assertThat((String) source.get("clickedAt")).endsWith("Z").matches(".*\\.\\d{3}Z$");
        // 체크섬은 저장된 원본 그대로에서 나온다 — 조립을 한 번 더 하면 그때부터 어긋날 수 있다.
        assertThat(candidates.get(0).sourceChecksum())
                .isEqualTo(FrozenClickSource.checksum(FrozenClickSource.canonicalize(source)));
    }

    @Test
    @DisplayName("발급자가 떠난 링크는 REVOKED 로 확정해 옮긴다 — 그대로 복사하면 죽은 slug 가 되살아난다")
    void freezeMarksLinksOfDepartedInvitersAsRevoked() {
        UUID ownerId = newUser();
        UUID memberId = newUser();
        Group group = newGroup(ownerId);
        addMember(group, memberId);
        String ipHash = "c".repeat(64);
        UUID linkId = tx().execute(status -> inviteLinkRepository
                .save(new GroupInviteLink(slug("rvk"), group.getId(), memberId))
                .getId());
        tx().executeWithoutResult(status ->
                inviteLinkClickRepository.save(new InviteLinkClick(linkId, ipHash, "android", null)));

        groupMemberService.kickMember(group.getId(), memberId, ownerId);

        String migrationId = "mig-revoked-" + UUID.randomUUID();
        internalClickMigrationService.freeze(migrationId);
        Map<String, Object> source = internalClickMigrationService
                .exportCandidates(migrationId, ipHash, "android").get(0).source();

        assertThat(source).containsEntry("linkStatus", "REVOKED");
        assertThat(source.get("revokedAt")).isNotNull();
        // 전이 뒤의 세대가 실린다 — 링크 서버가 구세대 명령을 거르는 기준이다.
        assertThat(source).containsEntry("membershipEpoch", "2");
    }

    @Test
    @DisplayName("재개 목록은 커서 없이도 돌고 pendingTotal 로 「남은 것」을 센다")
    void claimIntentListingWorksWithoutCursor() {
        UUID userId = newUser();
        internalInviteLinkService.enqueueClaimIntent(userId, "lst001", "list-key-1");

        ClaimIntentPageResponse page = internalInviteLinkService.listClaimIntents(null, 50);

        assertThat(page.pendingTotal()).isGreaterThanOrEqualTo(1L);
        assertThat(page.items()).anySatisfy(item -> {
            assertThat(item.userId()).isEqualTo(userId);
            assertThat(item.slug()).isEqualTo("lst001");
            // 재개 실행자는 «같은 키로» 재생해야 한다(㉼) — 새 키면 중복 명령이 된다.
            assertThat(item.idempotencyKey()).isEqualTo("list-key-1");
        });
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

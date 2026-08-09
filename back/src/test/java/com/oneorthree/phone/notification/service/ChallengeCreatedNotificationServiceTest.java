package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.lang.reflect.Method;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 새 챌린지 등록 알림(GROMO-1089) 단위 테스트.
 *
 * <p>검증 축: 개설자 제외 · dedup · 알림 설정 차단 · 문구(그룹명·목표) · 딥링크(결과 파라미터 없음) ·
 * 커밋 이후 발송 배선.
 */
@ExtendWith(MockitoExtension.class)
class ChallengeCreatedNotificationServiceTest {

    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID CREATOR_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID OTHER_MEMBER_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final Instant CREATED_AT = Instant.parse("2026-08-03T01:00:00Z");
    private static final Instant NOW = Instant.parse("2026-08-03T01:00:01Z");

    @Mock
    private GroupChallengeRepository groupChallengeRepository;
    @Mock
    private GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;

    @InjectMocks
    private ChallengeCreatedNotificationService service;

    // ── 트랜잭션 경계 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("발송 본체는 REQUIRES_NEW 로 연다 → 종료 중인 원 트랜잭션에 합류해 쓰기가 사라지지 않는다")
    void sendOpensItsOwnTransaction() throws NoSuchMethodException {
        // 무효 토큰 정리(더티체킹)와 발송 로그 저장이 트랜잭션 밖으로 새면 조용히 유실된다.
        // 목에는 트랜잭션이 없어 재현할 수 없으므로 경계 선언 자체를 계약으로 고정한다.
        Method send = ChallengeCreatedNotificationService.class.getMethod(
                "sendCreatedNotifications", GroupChallengeCreatedEvent.class, Instant.class);

        assertThat(send.getAnnotation(Transactional.class)).isNotNull();
        assertThat(send.getAnnotation(Transactional.class).propagation())
                .isEqualTo(Propagation.REQUIRES_NEW);
    }

    // ── 대상 선정 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("개설자 본인은 제외하고 나머지 그룹원에게만 발송")
    void excludesCreator() {
        GroupChallenge challenge = durationChallenge();
        givenChallenge(challenge);
        givenMembers(challenge, user(CREATOR_ID), user(MEMBER_ID), user(OTHER_MEMBER_ID));
        givenNoSentLogs();
        givenNoSettings();
        givenDurationDetail(30);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOW))).willReturn(true);

        int sent = service.sendCreatedNotifications(event(), NOW);

        assertThat(sent).isEqualTo(2);
        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(pushNotificationService, times(2))
                .sendIfAllowed(userCaptor.capture(), any(), any(), eq(NOW));
        assertThat(userCaptor.getAllValues()).extracting(User::getId)
                .containsExactlyInAnyOrder(MEMBER_ID, OTHER_MEMBER_ID);
    }

    @Test
    @DisplayName("탈퇴 유저는 발송 대상에서 제외")
    void excludesDeletedUser() {
        GroupChallenge challenge = durationChallenge();
        givenChallenge(challenge);
        User deleted = User.builder().id(MEMBER_ID).nickname("탈퇴")
                .deviceToken("token").isDeleted(true).build();
        givenMembers(challenge, user(CREATOR_ID), deleted);

        int sent = service.sendCreatedNotifications(event(), NOW);

        assertThat(sent).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("삭제된 챌린지 이벤트 → 발송하지 않음")
    void skipsDeletedChallenge() {
        GroupChallenge challenge = durationChallenge();
        challenge.softDelete();
        given(groupChallengeRepository.findById(CHALLENGE_ID)).willReturn(Optional.of(challenge));

        int sent = service.sendCreatedNotifications(event(), NOW);

        assertThat(sent).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    // ── dedup · 설정 ──────────────────────────────────────────────────────

    @Test
    @DisplayName("같은 (유저, 챌린지) 로그가 있으면 재발송하지 않는다")
    void dedupesByUserAndChallenge() {
        GroupChallenge challenge = durationChallenge();
        givenChallenge(challenge);
        givenMembers(challenge, user(CREATOR_ID), user(MEMBER_ID), user(OTHER_MEMBER_ID));
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_CREATED), anyList(), any()))
                .willReturn(List.of(NotificationSentLog.builder()
                        .userId(MEMBER_ID)
                        .type(NotificationSentLog.TYPE_CHALLENGE_CREATED)
                        .targetUserId(CHALLENGE_ID)
                        .sentAt(CREATED_AT)
                        .build()));
        givenNoSettings();
        givenDurationDetail(30);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOW))).willReturn(true);

        int sent = service.sendCreatedNotifications(event(), NOW);

        assertThat(sent).isEqualTo(1);
        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(pushNotificationService).sendIfAllowed(userCaptor.capture(), any(), any(), eq(NOW));
        assertThat(userCaptor.getValue().getId()).isEqualTo(OTHER_MEMBER_ID);
    }

    @Test
    @DisplayName("dedup 조회 하한은 챌린지 생성 시각 - 여유분")
    void dedupLookbackStartsAtChallengeCreatedAt() {
        GroupChallenge challenge = durationChallenge();
        givenChallenge(challenge);
        givenMembers(challenge, user(CREATOR_ID), user(MEMBER_ID));
        givenNoSentLogs();
        givenNoSettings();
        givenDurationDetail(30);

        service.sendCreatedNotifications(event(), NOW);

        ArgumentCaptor<Instant> sinceCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(notificationSentLogRepository).findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_CREATED), anyList(), sinceCaptor.capture());
        assertThat(sinceCaptor.getValue())
                .isEqualTo(CREATED_AT.minus(ChallengeCreatedNotificationService.DEDUP_LOOKBACK_MARGIN));
    }

    @Test
    @DisplayName("알림 설정·야간 모드로 차단(sendIfAllowed=false)되면 발송 로그를 남기지 않는다")
    void doesNotLogWhenBlockedBySettings() {
        GroupChallenge challenge = durationChallenge();
        givenChallenge(challenge);
        givenMembers(challenge, user(CREATOR_ID), user(MEMBER_ID));
        givenNoSentLogs();
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.of(UserNotificationSettings.builder()
                        .userId(MEMBER_ID).notificationEnabled(false).build()));
        givenDurationDetail(30);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOW))).willReturn(false);

        int sent = service.sendCreatedNotifications(event(), NOW);

        assertThat(sent).isZero();
        ArgumentCaptor<List<NotificationSentLog>> logCaptor = captureLogs();
        verify(notificationSentLogRepository).saveAll(logCaptor.capture());
        assertThat(logCaptor.getValue()).isEmpty();
    }

    @Test
    @DisplayName("발송 성공분만 (유저, 챌린지) 로그로 남는다")
    void logsOnlySuccessfulSends() {
        GroupChallenge challenge = durationChallenge();
        givenChallenge(challenge);
        givenMembers(challenge, user(CREATOR_ID), user(MEMBER_ID), user(OTHER_MEMBER_ID));
        givenNoSentLogs();
        givenNoSettings();
        givenDurationDetail(30);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOW)))
                .willReturn(true, false);

        service.sendCreatedNotifications(event(), NOW);

        ArgumentCaptor<List<NotificationSentLog>> logCaptor = captureLogs();
        verify(notificationSentLogRepository).saveAll(logCaptor.capture());
        assertThat(logCaptor.getValue()).hasSize(1);
        assertThat(logCaptor.getValue().get(0).getType())
                .isEqualTo(NotificationSentLog.TYPE_CHALLENGE_CREATED);
        assertThat(logCaptor.getValue().get(0).getTargetUserId()).isEqualTo(CHALLENGE_ID);
        assertThat(logCaptor.getValue().get(0).getSentAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("한 유저 발송이 예외로 죽어도 나머지 그룹원 발송은 계속된다")
    void isolatesPerUserFailure() {
        GroupChallenge challenge = durationChallenge();
        givenChallenge(challenge);
        givenMembers(challenge, user(CREATOR_ID), user(MEMBER_ID), user(OTHER_MEMBER_ID));
        givenNoSentLogs();
        givenNoSettings();
        givenDurationDetail(30);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOW)))
                .willThrow(new IllegalStateException("boom"))
                .willReturn(true);

        int sent = service.sendCreatedNotifications(event(), NOW);

        assertThat(sent).isEqualTo(1);
    }

    // ── 문구 · 딥링크 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("DURATION 문구 — 제목에 그룹명, 본문에 목표")
    void composesDurationMessage() {
        GroupChallenge challenge = durationChallenge();
        givenDurationDetail(60);

        PushMessage message = service.compose(challenge, service.missionLabel(challenge), true);

        assertThat(message.title()).isEqualTo("열공모임에 새 챌린지가 열렸어요");
        assertThat(message.body()).isEqualTo("하루 60분 집중 — 지금 참여해보세요");
    }

    @Test
    @DisplayName("TIME_WINDOW · SCREEN_TIME 문구 — 창 시각과 창 내 목표분이 함께 드러난다")
    void composesTimeWindowMessage() {
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group())
                .category(MissionCategory.SCREEN_TIME).type(MissionType.TIME_WINDOW)
                .status(GroupChallengeStatus.ACTIVE).createdAt(CREATED_AT).build();
        given(groupChallengeWindowRepository.findByChallengeIdIn(anyCollection()))
                .willReturn(List.of(GroupChallengeWindow.builder()
                        .challengeId(CHALLENGE_ID).challenge(challenge)
                        .windowStart(LocalTime.of(21, 0))
                        .windowEnd(LocalTime.of(23, 30))
                        .durationMinutes(30)
                        .build()));

        assertThat(service.missionLabel(challenge)).isEqualTo("매일 21:00~23:30 30분 스크린타임");
    }

    @Test
    @DisplayName("상세 행이 없으면 목표를 지어내지 않고 카테고리 명사로 떨어뜨린다")
    void fallsBackToCategoryLabelWithoutDetail() {
        GroupChallenge challenge = durationChallenge();
        given(groupChallengeDurationRepository.findByChallengeIdIn(anyCollection()))
                .willReturn(List.of());

        assertThat(service.missionLabel(challenge)).isEqualTo("집중 시간");
    }

    @Test
    @DisplayName("딥링크는 그룹까지만 — 결과 모달용 challenge 파라미터를 붙이지 않는다")
    void deepLinkHasNoChallengeParam() {
        GroupChallenge challenge = durationChallenge();

        PushMessage message = service.compose(challenge, "하루 30분 집중", true);

        assertThat(message.link()).isEqualTo("gromo://group?g=" + GROUP_ID);
        assertThat(message.link()).doesNotContain("challenge=");
        assertThat(message.toDataPayload())
                .containsEntry("type", "CHALLENGE_CREATED")
                .containsEntry("groupId", GROUP_ID.toString());
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────

    private static GroupChallengeCreatedEvent event() {
        return new GroupChallengeCreatedEvent(CHALLENGE_ID, GROUP_ID, CREATOR_ID);
    }

    private static Group group() {
        return Group.builder().id(GROUP_ID).name("열공모임").build();
    }

    private static GroupChallenge durationChallenge() {
        return GroupChallenge.builder()
                .id(CHALLENGE_ID)
                .group(group())
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .status(GroupChallengeStatus.ACTIVE)
                .createdAt(CREATED_AT)
                .build();
    }

    private static User user(UUID id) {
        return User.builder().id(id).nickname("유저").deviceToken("token-" + id).build();
    }

    /** 창 시각은 KST 벽시계 time-of-day 로 해석된다(WindowFocusAggregator.timeOfDay, GROMO-1100). */
    private static Instant timeOfDay(LocalTime time) {
        return LocalDate.EPOCH.atTime(time).atZone(ZoneId.of("Asia/Seoul")).toInstant();
    }

    private void givenChallenge(GroupChallenge challenge) {
        given(groupChallengeRepository.findById(CHALLENGE_ID)).willReturn(Optional.of(challenge));
    }

    private void givenMembers(GroupChallenge challenge, User... users) {
        given(groupMemberRepository.findByGroup(challenge.getGroup())).willReturn(
                List.of(users).stream()
                        .map(user -> GroupMember.builder().id(UUID.randomUUID())
                                .group(challenge.getGroup()).user(user).build())
                        .toList());
    }

    private void givenNoSentLogs() {
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_CREATED), anyList(), any()))
                .willReturn(List.of());
    }

    private void givenNoSettings() {
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.<UserNotificationSettings>of());
    }

    private void givenDurationDetail(int minutes) {
        given(groupChallengeDurationRepository.findByChallengeIdIn(anyCollection()))
                .willReturn(List.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID).durationMinutes(minutes).build()));
    }

    @SuppressWarnings("unchecked")
    private static ArgumentCaptor<List<NotificationSentLog>> captureLogs() {
        return ArgumentCaptor.forClass(List.class);
    }
}

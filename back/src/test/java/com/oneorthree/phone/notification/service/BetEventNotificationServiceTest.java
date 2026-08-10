package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 사건 단위 알림 파이프라인의 단위 테스트 — 잠그는 성질:
 * <ol>
 *   <li><b>클레임과 발송이 분리</b>됐다 — 이벤트는 선점만 하고, 같은 슬롯의 사건 여럿이 각각
 *       이벤트로 들어와도 <b>푸시는 슬롯당 한 건</b>이다(N20 · codex P1),</li>
 *   <li>슬롯이 닫히기 전에는 발송하지 않는다(누적 창),</li>
 *   <li>BET_VOID_REFUND payload 가 사유 3종(N48)을 정확히 싣는다,</li>
 *   <li>조용한 시간의 표시 푸시는 DEFERRED 로 이월되고(N44) 이후 flush 에서 나간다,</li>
 *   <li>발송 실패·필터 스킵은 클레임을 반납해 재훑기가 다시 집게 한다.</li>
 * </ol>
 *
 * <p>리포지토리 목은 <b>클레임 저장소를 흉내</b>낸다({@link #recordedClaims}) — 선점 행 id 가
 * 서비스 안에서 생성되므로, INSERT 를 가로채 행을 만들어 두고 flush 조회가 그 행을 돌려주게 한다.
 * 선점 유니크·SKIP LOCKED 의 실제 계약은 통합 테스트가 실 DB 로 잠근다.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BetEventNotificationServiceTest {

    /** KST 12:20 — 조용한 시간(23–07) 밖. */
    private static final Instant NOON = Instant.parse("2026-08-02T03:20:00Z");
    /** KST 00:10 — 조용한 시간 한복판(하루형 자정 정산 직후). */
    private static final Instant MIDNIGHT = Instant.parse("2026-08-01T15:10:00Z");
    /** KST 07:00 — 조용한 시간 종료 정각. */
    private static final Instant SEVEN = Instant.parse("2026-08-01T22:00:00Z");
    private static final UUID GROUP_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private BetEventNotificationService service;

    /** 목이 흉내내는 클레임 저장소 — insertPendingClaim 이 넣고 findDueClaimsForUpdate 가 읽는다. */
    private final List<NotificationSentLog> recordedClaims = new ArrayList<>();

    @BeforeEach
    void wireClaimStore() {
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any()))
                .willAnswer(invocation -> {
                    UUID rowId = invocation.getArgument(0);
                    UUID userId = invocation.getArgument(1);
                    String kind = invocation.getArgument(2);
                    UUID subjectId = invocation.getArgument(3);
                    boolean exists = recordedClaims.stream().anyMatch(row ->
                            row.getUserId().equals(userId) && row.getKind().equals(kind)
                                    && row.getSubjectId().equals(subjectId));
                    if (exists) {
                        return 0;   // 유니크 충돌 = 이미 선점됨
                    }
                    recordedClaims.add(NotificationSentLog.builder()
                            .id(rowId)
                            .userId(userId)
                            .type(kind)
                            .kind(kind)
                            .subjectId(subjectId)
                            .groupId(invocation.getArgument(4))
                            .slotAt(invocation.getArgument(5))
                            .claimedAt(invocation.getArgument(6))
                            .status(NotificationSendStatus.PENDING)
                            .build());
                    return 1;
                });
        given(notificationSentLogRepository.findDueClaimsForUpdate(anyCollection(), any()))
                .willAnswer(invocation -> {
                    Collection<String> kinds = invocation.getArgument(0);
                    Instant slotClosedBefore = invocation.getArgument(1);
                    return recordedClaims.stream()
                            .filter(row -> kinds.contains(row.getKind()))
                            .filter(row -> row.getStatus() == NotificationSendStatus.DEFERRED
                                    || !row.getSlotAt().isAfter(slotClosedBefore))
                            .toList();
                });
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.<UserNotificationSettings>of());
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);
    }

    private static User user(UUID id) {
        return User.builder().id(id).nickname("유저").deviceToken("token-" + id).build();
    }

    private static GroupChallengeBetSession session(
            GroupBetStatus status, GroupBetVoidReason voidReason, Instant settledAt) {
        Group group = Group.builder().id(GROUP_ID).name("그룹").build();
        GroupChallenge challenge = GroupChallenge.builder().id(UUID.randomUUID()).group(group).build();
        return GroupChallengeBetSession.builder()
                .id(UUID.randomUUID())
                .group(group)
                .challenge(challenge)
                .stake(50)
                .sessionDate(LocalDate.of(2026, 8, 1))
                .status(status)
                .voidReason(voidReason)
                .settledAt(settledAt)
                .build();
    }

    private static GroupChallengeBetParticipant participant(
            GroupChallengeBetSession session, User user, Boolean achieved, Integer payout) {
        return GroupChallengeBetParticipant.builder()
                .id(UUID.randomUUID())
                .session(session)
                .user(user)
                .achieved(achieved)
                .payout(payout)
                .build();
    }

    /** 이벤트 경로 입력 — 회차 단건 조회 + 그 회차의 참가자. */
    private void givenEventSession(GroupChallengeBetSession session,
            List<GroupChallengeBetParticipant> participants) {
        given(groupChallengeBetSessionRepository.findById(session.getId()))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(participants);
    }

    /** flush 가 클레임 행에서 회차·참가자를 재조립할 때 쓰는 입력. */
    private void givenFlushLookup(List<GroupChallengeBetSession> sessions,
            List<GroupChallengeBetParticipant> participants) {
        given(groupChallengeBetSessionRepository.findAllById(anyCollection())).willReturn(sessions);
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(participants);
    }

    private PushMessage singleSentMessage() {
        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(any(), any(), captor.capture(), any());
        return captor.getValue();
    }

    @Test
    @DisplayName("N20 — 같은 슬롯의 회차 2건이 각각 이벤트로 들어와도 푸시는 한 건이다 (묶음)")
    void separateEventsInSameSlotProduceOnePush() {
        UUID userId = UUID.randomUUID();
        User target = user(userId);
        // 정산 배치가 12:01·12:03 에 같은 그룹의 회차 둘을 끝낸다 → 같은 12:00 슬롯.
        GroupChallengeBetSession first =
                session(GroupBetStatus.SETTLED, null, Instant.parse("2026-08-02T03:01:00Z"));
        GroupChallengeBetSession second =
                session(GroupBetStatus.SETTLED, null, Instant.parse("2026-08-02T03:03:00Z"));
        GroupChallengeBetParticipant firstParticipant = participant(first, target, true, 100);
        GroupChallengeBetParticipant secondParticipant = participant(second, target, false, 0);

        // 이벤트 2회 — 각각 별도 트랜잭션·별도 호출(실제 AFTER_COMMIT 리스너와 같다).
        givenEventSession(first, List.of(firstParticipant));
        service.notifySessionClosed(first.getId(), Instant.parse("2026-08-02T03:01:30Z"));
        givenEventSession(second, List.of(secondParticipant));
        service.notifySessionClosed(second.getId(), Instant.parse("2026-08-02T03:03:30Z"));

        // 이 시점까지 발송은 0건이어야 한다 — 슬롯이 아직 안 닫혔고, 무엇보다 이벤트는 보내지 않는다.
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());

        // 슬롯(12:00~12:15)이 닫힌 뒤 첫 flush.
        givenFlushLookup(List.of(first, second), List.of(firstParticipant, secondParticipant));
        var summary = service.flushDueBundles(NOON);

        assertThat(summary.sentCount()).isEqualTo(2);   // 사건 2건이 종결됐고
        PushMessage message = singleSentMessage();      // 푸시는 정확히 1회다
        assertThat(message.body()).contains("2건");
        assertThat(message.data()).doesNotContainKey("challengeId");
    }

    @Test
    @DisplayName("N41 — 한 슬롯에 결과와 무산 환불이 섞여도 묶음은 한 건이다 (묶음 키에 kind 없음)")
    void mixedKindsInOneSlotProduceOnePush() {
        UUID userId = UUID.randomUUID();
        User target = user(userId);
        // 같은 12:00 슬롯에서 한 회차는 정산되고 다른 회차는 삭제로 무효화됐다.
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, Instant.parse("2026-08-02T03:01:00Z"));
        GroupChallengeBetSession voided = session(GroupBetStatus.VOIDED,
                GroupBetVoidReason.CHALLENGE_DELETED, Instant.parse("2026-08-02T03:04:00Z"));
        GroupChallengeBetParticipant settledParticipant = participant(settled, target, true, 100);
        GroupChallengeBetParticipant voidedParticipant = participant(voided, target, null, null);

        givenEventSession(settled, List.of(settledParticipant));
        service.notifySessionClosed(settled.getId(), Instant.parse("2026-08-02T03:01:30Z"));
        givenEventSession(voided, List.of(voidedParticipant));
        service.notifySessionClosed(voided.getId(), Instant.parse("2026-08-02T03:04:30Z"));

        givenFlushLookup(List.of(settled, voided), List.of(settledParticipant, voidedParticipant));
        var summary = service.flushDueBundles(NOON);

        assertThat(summary.sentCount()).isEqualTo(2);
        PushMessage message = singleSentMessage();   // kind 가 달라도 푸시는 1회다
        assertThat(message.body()).isEqualTo("결과 1건 · 무산 환불 1건 — 그룹에서 확인하세요");
        assertThat(message.data())
                // 결과 모달이 열려야 결과분이 소비된다 — 환불분은 본문이 알린다.
                .containsEntry("type", NotificationSentLog.TYPE_BET_RESULT)
                .containsEntry("groupId", GROUP_ID.toString())
                // 혼합 슬롯에서 사유는 알림 전체를 대표하지 못한다.
                .doesNotContainKey("voidReason")
                .doesNotContainKey("challengeId");
    }

    @Test
    @DisplayName("한 슬롯이 전부 무산 환불이고 사유가 하나면 voidReason 을 싣는다")
    void allRefundBundleKeepsSingleReason() {
        User target = user(UUID.randomUUID());
        GroupChallengeBetSession first = session(GroupBetStatus.VOIDED,
                GroupBetVoidReason.CHALLENGE_DELETED, Instant.parse("2026-08-02T03:01:00Z"));
        GroupChallengeBetSession second = session(GroupBetStatus.VOIDED,
                GroupBetVoidReason.CHALLENGE_DELETED, Instant.parse("2026-08-02T03:02:00Z"));
        GroupChallengeBetParticipant firstParticipant = participant(first, target, null, null);
        GroupChallengeBetParticipant secondParticipant = participant(second, target, null, null);

        givenEventSession(first, List.of(firstParticipant));
        service.notifySessionClosed(first.getId(), Instant.parse("2026-08-02T03:01:30Z"));
        givenEventSession(second, List.of(secondParticipant));
        service.notifySessionClosed(second.getId(), Instant.parse("2026-08-02T03:02:30Z"));

        givenFlushLookup(List.of(first, second), List.of(firstParticipant, secondParticipant));
        service.flushDueBundles(NOON);

        PushMessage message = singleSentMessage();
        assertThat(message.body()).isEqualTo("내기 2건이 무산돼 참가비를 돌려드렸어요");
        assertThat(message.data())
                .containsEntry("type", NotificationSentLog.TYPE_BET_VOID_REFUND)
                .containsEntry("voidReason", GroupBetVoidReason.CHALLENGE_DELETED.name());
    }

    @Test
    @DisplayName("수동 트리거 경로 — 슬롯이 닫히지 않아도 즉시 발송한다 (QA 검증 동선)")
    void immediatePathSendsWithoutWaitingForSlotClose() {
        User target = user(UUID.randomUUID());
        // 방금(12:16) 종료된 회차 — 슬롯 12:15 는 12:30 에야 닫힌다.
        GroupChallengeBetSession justSettled =
                session(GroupBetStatus.SETTLED, null, Instant.parse("2026-08-02T03:16:00Z"));
        GroupChallengeBetParticipant betParticipant = participant(justSettled, target, true, 100);
        given(groupChallengeBetSessionRepository.findByStatusInAndSettledAtSince(anyCollection(), any()))
                .willReturn(List.of(justSettled));
        givenFlushLookup(List.of(justSettled), List.of(betParticipant));

        // 크론 경로(immediate=false)는 아직 안 보낸다.
        assertThat(service.rescanAndFlush(NOON).sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());

        // 수동 경로는 같은 상태에서 발송까지 간다.
        var manual = service.rescanAndFlush(NOON, true);

        assertThat(manual.sentCount()).isEqualTo(1);
        verify(pushNotificationService).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("슬롯이 닫히기 전에는 발송하지 않는다 — 누적 창을 지킨다")
    void doesNotSendBeforeSlotCloses() {
        User target = user(UUID.randomUUID());
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, Instant.parse("2026-08-02T03:16:00Z"));
        givenEventSession(settled, List.of(participant(settled, target, true, 100)));

        service.notifySessionClosed(settled.getId(), Instant.parse("2026-08-02T03:16:30Z"));
        // 12:20 — 슬롯 12:15 는 12:30 에 닫힌다. 아직 이르다.
        var early = service.flushDueBundles(NOON);

        assertThat(early.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("N48 — CHALLENGE_DELETED 환불 payload: type·groupId·challengeId·voidReason")
    void voidRefundPayloadForChallengeDeleted() {
        assertVoidRefundPayload(GroupBetStatus.VOIDED, GroupBetVoidReason.CHALLENGE_DELETED,
                "챌린지가 삭제돼 무산됐어요 · 참가비는 돌려드렸어요");
    }

    @Test
    @DisplayName("N48 — INSUFFICIENT_PARTICIPANTS 환불 payload")
    void voidRefundPayloadForInsufficientParticipants() {
        assertVoidRefundPayload(GroupBetStatus.VOIDED, GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS,
                "참가자가 부족해 무산됐어요 · 참가비는 돌려드렸어요");
    }

    @Test
    @DisplayName("N48 — REFUND_DEADLINE(24h 자동 환불) payload")
    void voidRefundPayloadForRefundDeadline() {
        assertVoidRefundPayload(GroupBetStatus.REFUNDED, GroupBetVoidReason.REFUND_DEADLINE,
                "정산이 지연돼 참가비를 돌려드렸어요");
    }

    private void assertVoidRefundPayload(GroupBetStatus status, GroupBetVoidReason reason,
            String expectedBody) {
        GroupChallengeBetSession voided =
                session(status, reason, NOON.minus(Duration.ofMinutes(30)));
        User target = user(UUID.randomUUID());
        GroupChallengeBetParticipant betParticipant = participant(voided, target, null, null);
        givenEventSession(voided, List.of(betParticipant));

        service.notifySessionClosed(voided.getId(), NOON.minus(Duration.ofMinutes(29)));
        givenFlushLookup(List.of(voided), List.of(betParticipant));
        service.flushDueBundles(NOON);

        PushMessage message = singleSentMessage();
        assertThat(message.body()).isEqualTo(expectedBody);
        assertThat(message.data())
                .containsEntry("type", NotificationSentLog.TYPE_BET_VOID_REFUND)
                .containsEntry("groupId", GROUP_ID.toString())
                .containsEntry("challengeId", voided.getChallenge().getId().toString())
                .containsEntry("voidReason", reason.name());
        // 신설 타입은 link 를 싣지 않는다 — 앱이 data.groupId 로 딥링크를 합성한다(IA §4.2).
        assertThat(message.link()).isNull();
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), eq(NOON));
    }

    @Test
    @DisplayName("N44 — 조용한 시간(00:10)의 결과는 발송하지 않고 DEFERRED 로 이월한다")
    void defersDisplayPushDuringQuietHours() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, MIDNIGHT.minus(Duration.ofMinutes(30)));
        User target = user(UUID.randomUUID());
        GroupChallengeBetParticipant betParticipant = participant(settled, target, true, 100);
        givenEventSession(settled, List.of(betParticipant));

        service.notifySessionClosed(settled.getId(), MIDNIGHT.minus(Duration.ofMinutes(29)));
        givenFlushLookup(List.of(settled), List.of(betParticipant));
        service.flushDueBundles(MIDNIGHT);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.DEFERRED), eq(null));
        verify(notificationSentLogRepository, never()).deleteByIds(anyCollection());
    }

    @Test
    @DisplayName("N44 — 이월분은 07:00 flush 에서 발송되고 SENT 로 종결된다 (하루형 자정 정산 → 아침 도착)")
    void flushSendsDeferredAfterQuietHours() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, MIDNIGHT.minus(Duration.ofMinutes(30)));
        User target = user(UUID.randomUUID());
        GroupChallengeBetParticipant betParticipant = participant(settled, target, true, 100);
        NotificationSentLog deferredRow = NotificationSentLog.builder()
                .id(UUID.randomUUID())
                .userId(target.getId())
                .type(NotificationSentLog.TYPE_BET_RESULT)
                .kind(NotificationSentLog.TYPE_BET_RESULT)
                .subjectId(settled.getId())
                .groupId(GROUP_ID)
                .slotAt(BetEventNotificationService.slotOf(settled.getSettledAt()))
                .status(NotificationSendStatus.DEFERRED)
                .claimedAt(MIDNIGHT)
                .build();
        recordedClaims.add(deferredRow);
        givenFlushLookup(List.of(settled), List.of(betParticipant));

        var summary = service.flushDueBundles(SEVEN);

        assertThat(summary.sentCount()).isEqualTo(1);
        verify(notificationSentLogRepository).updateStatusByIds(
                eq(List.of(deferredRow.getId())), eq(NotificationSendStatus.SENT), eq(SEVEN));
        PushMessage message = singleSentMessage();
        assertThat(message.data()).containsEntry("challengeId",
                settled.getChallenge().getId().toString());
    }

    @Test
    @DisplayName("발송 실패·필터 스킵 — 클레임을 반납(삭제)해 재훑기가 다시 집는다")
    void releasesClaimWhenSendFails() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, NOON.minus(Duration.ofMinutes(30)));
        User target = user(UUID.randomUUID());
        GroupChallengeBetParticipant betParticipant = participant(settled, target, true, 100);
        givenEventSession(settled, List.of(betParticipant));
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(false);

        service.notifySessionClosed(settled.getId(), NOON.minus(Duration.ofMinutes(29)));
        givenFlushLookup(List.of(settled), List.of(betParticipant));
        service.flushDueBundles(NOON);

        verify(notificationSentLogRepository).deleteByIds(anyCollection());
        verify(notificationSentLogRepository, never()).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("이미 선점된 사건(INSERT 0 + 리스 생존) — dedup 으로 스킵하고 클레임을 늘리지 않는다")
    void skipsAlreadyClaimedEvent() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, NOON.minus(Duration.ofMinutes(30)));
        User target = user(UUID.randomUUID());
        GroupChallengeBetParticipant betParticipant = participant(settled, target, true, 100);
        givenEventSession(settled, List.of(betParticipant));
        given(notificationSentLogRepository.reclaimExpired(any(), anyString(), any(), any(), any()))
                .willReturn(0);

        service.notifySessionClosed(settled.getId(), NOON.minus(Duration.ofMinutes(29)));
        service.notifySessionClosed(settled.getId(), NOON.minus(Duration.ofMinutes(28)));

        assertThat(recordedClaims).hasSize(1);
    }
}

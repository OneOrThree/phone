package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
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
 * 사일런트 flush 푸시(GROMO-1281, FR-22)의 단위 테스트 — 잠그는 성질 넷:
 * ① data-only payload 가 A2 계약({@code silent:'flush'})을 정확히 싣는다,
 * ② 스캔 창이 {@code settle_after} − 15분이다(그레이스 진입이 아니다 — 마지막 15분 버킷 반영),
 * ③ 5분 크론이 그 창을 3틱 훑어도 <b>첫 틱만</b> 나간다(클레임 dedup),
 * ④ 발송 실패는 클레임을 반납해 창이 남아 있으면 다음 틱이 재시도한다.
 * (조합별 대상 선정 — FOCUS 하루형 포함 · SCREEN_TIME 하루형 제외 — 은 쿼리 술어라
 * {@code SilentFlushTargetQueryIntegrationTest} 가 실 DB 로 잠근다.)
 */
@ExtendWith(MockitoExtension.class)
class SilentFlushPushServiceTest {

    /**
     * 창 09:00~12:00(KST) · {@code settle_after} = 창 끝+30분 = 12:30 → 발송 슬롯은 12:15 다
     * (settle_after − 15분). 종전 "그레이스 진입(12:05)" 단정을 이 축으로 갱신했다.
     */
    private static final Instant NOW = Instant.parse("2026-08-02T03:15:00Z");
    private static final UUID GROUP_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private SilentFlushPushService service;

    private static GroupChallengeBetSession graceSession() {
        Group group = Group.builder().id(GROUP_ID).name("그룹").build();
        GroupChallenge challenge = GroupChallenge.builder().id(UUID.randomUUID()).group(group).build();
        return GroupChallengeBetSession.builder()
                .id(UUID.randomUUID())
                .group(group)
                .challenge(challenge)
                .stake(50)
                .sessionDate(LocalDate.of(2026, 8, 2))
                .missionCategory(MissionCategory.SCREEN_TIME)
                .missionType(MissionType.TIME_WINDOW)
                .windowStart(LocalTime.of(9, 0))
                .windowEnd(LocalTime.of(12, 0))
                .closesAt(NOW.minus(Duration.ofMinutes(15)))       // 12:00 KST
                .settleAfter(NOW.plus(Duration.ofMinutes(15)))     // 12:30 KST — 슬롯은 NOW(12:15)
                .build();
    }

    private static GroupChallengeBetParticipant participant(GroupChallengeBetSession session, User user) {
        return GroupChallengeBetParticipant.builder()
                .id(UUID.randomUUID()).session(session).user(user).build();
    }

    private static User user(UUID id) {
        return User.builder().id(id).nickname("유저").deviceToken("token-" + id).build();
    }

    @Test
    @DisplayName("정산 15분 전 회차의 참가자에게 data-only {silent:'flush'} 가 나가고 클레임이 SENT 로 남는다")
    void sendsSilentFlushToParticipantsInGrace() {
        GroupChallengeBetSession session = graceSession();
        User target = user(UUID.randomUUID());
        given(groupChallengeBetSessionRepository.findSilentFlushTargets(
                NOW, NOW.plus(SilentFlushPushService.SETTLE_LEAD))).willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of(participant(session, target)));
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        given(pushNotificationService.sendSilentPush(any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary = service.sendGraceFlushPushes(NOW);

        assertThat(summary.sentCount()).isEqualTo(1);
        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendSilentPush(any(), captor.capture());
        PushMessage message = captor.getValue();
        assertThat(message.isSilent()).isTrue();
        assertThat(message.data())
                .containsEntry("silent", "flush")
                .containsEntry("groupId", GROUP_ID.toString());
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), eq(NOW));
    }

    @Test
    @DisplayName("이미 클레임된 회차 — 5분 스캔이 다시 훑어도 재발송하지 않는다(dedup)")
    void dedupsAlreadyClaimedSession() {
        GroupChallengeBetSession session = graceSession();
        given(groupChallengeBetSessionRepository.findSilentFlushTargets(
                NOW, NOW.plus(SilentFlushPushService.SETTLE_LEAD))).willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of(participant(session, user(UUID.randomUUID()))));
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(0);

        PushDispatchSummaryResponse summary = service.sendGraceFlushPushes(NOW);

        assertThat(summary.sentCount()).isZero();
        assertThat(summary.dedupedCount()).isEqualTo(1);
        verify(pushNotificationService, never()).sendSilentPush(any(), any());
    }

    @Test
    @DisplayName("5분 크론이 15분 창을 3틱 훑어도 첫 틱만 발송된다 (클레임 dedup)")
    void onlyFirstOfThreeTicksSends() {
        GroupChallengeBetSession session = graceSession();
        User target = user(UUID.randomUUID());
        // 12:15 · 12:20 · 12:25 — settle_after(12:30) 직전 15분 창에 드는 세 틱.
        List<Instant> ticks = List.of(NOW, NOW.plus(Duration.ofMinutes(5)),
                NOW.plus(Duration.ofMinutes(10)));
        for (Instant tick : ticks) {
            given(groupChallengeBetSessionRepository.findSilentFlushTargets(
                    tick, tick.plus(SilentFlushPushService.SETTLE_LEAD))).willReturn(List.of(session));
        }
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of(participant(session, target)));
        // 첫 선점만 성공, 이후 틱은 유니크 충돌로 0행(실 DB 동작 — 클레임 리스 테스트가 SQL 로 잠근다).
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any()))
                .willReturn(1, 0, 0);
        given(pushNotificationService.sendSilentPush(any(), any())).willReturn(true);

        int sent = 0;
        int deduped = 0;
        for (Instant tick : ticks) {
            PushDispatchSummaryResponse summary = service.sendGraceFlushPushes(tick);
            sent += summary.sentCount();
            deduped += summary.dedupedCount();
        }

        assertThat(sent).isEqualTo(1);
        assertThat(deduped).isEqualTo(2);
        verify(pushNotificationService).sendSilentPush(any(), any());
    }

    @Test
    @DisplayName("발송 실패 — 클레임을 반납(삭제)해 창이 남아 있으면 다음 틱이 재시도한다")
    void releasesClaimOnFailure() {
        GroupChallengeBetSession session = graceSession();
        given(groupChallengeBetSessionRepository.findSilentFlushTargets(
                NOW, NOW.plus(SilentFlushPushService.SETTLE_LEAD))).willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of(participant(session, user(UUID.randomUUID()))));
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        given(pushNotificationService.sendSilentPush(any(), any())).willReturn(false);

        PushDispatchSummaryResponse summary = service.sendGraceFlushPushes(NOW);

        assertThat(summary.sentCount()).isZero();
        assertThat(summary.skippedCount()).isEqualTo(1);
        verify(notificationSentLogRepository).deleteByIds(anyCollection());
    }
}

package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
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

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 정산 결과 푸시의 <b>대상 산출·문구·dedup</b> 단위 테스트.
 *
 * <p>여기서 잠그는 성질은 셋이다: ① 승/패/몰수 문구가 참가자 상태로 정확히 갈리는가,
 * ② 이미 보낸 (유저, 내기) 조합이 재실행에서 0건 발송으로 빠지는가,
 * ③ 발송이 성사된 건만 sent_log 에 남는가(quiet hours 스킵을 발송으로 오기록하지 않기).
 */
@ExtendWith(MockitoExtension.class)
class BetResultNotificationServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-02T23:00:00Z"); // KST 08:00
    private static final UUID GROUP_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private BetResultNotificationService service;

    private static User user(UUID id) {
        return User.builder().id(id).nickname("유저" + id).deviceToken("token-" + id).build();
    }

    private static GroupChallengeBet bet(GroupBetStatus status, int stake) {
        Group group = Group.builder().id(GROUP_ID).name("그룹").build();
        GroupChallenge challenge = GroupChallenge.builder().id(UUID.randomUUID()).group(group).build();
        return GroupChallengeBet.builder()
                .id(UUID.randomUUID())
                .group(group)
                .challenge(challenge)
                .stake(stake)
                .betDate(LocalDate.of(2026, 8, 1))
                .status(status)
                .settledAt(NOW.minusSeconds(3600))
                .build();
    }

    private static GroupChallengeBetParticipant participant(
            GroupChallengeBet bet, User user, Boolean achieved, Integer payout) {
        return GroupChallengeBetParticipant.builder()
                .id(UUID.randomUUID())
                .bet(bet)
                .user(user)
                .achieved(achieved)
                .payout(payout)
                .build();
    }

    private void givenBets(List<GroupChallengeBet> bets, List<GroupChallengeBetParticipant> participants) {
        given(groupChallengeBetRepository.findByStatusInAndSettledAtSince(anyCollection(), any()))
                .willReturn(bets);
        if (!bets.isEmpty()) {
            given(groupChallengeBetParticipantRepository.findByBetIdIn(anyCollection()))
                    .willReturn(participants);
        }
    }

    private void givenNoSentLogs() {
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_BET_RESULT), anyList(), any())).willReturn(List.of());
    }

    private void givenNoSettings() {
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.<UserNotificationSettings>of());
    }

    private void givenAllSendsSucceed() {
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOW))).willReturn(true);
    }

    private List<PushMessage> capturedMessages() {
        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, atLeastOnce())
                .sendIfAllowed(any(), any(), captor.capture(), eq(NOW));
        return captor.getAllValues();
    }

    @Test
    @DisplayName("승자에게는 받은 금액이, 패자에게는 잃은 참가비가 실린 문구가 나간다")
    void composesWinnerAndLoserBodies() {
        GroupChallengeBet settled = bet(GroupBetStatus.SETTLED, 50);
        User winner = user(UUID.randomUUID());
        User loser = user(UUID.randomUUID());
        givenBets(List.of(settled), List.of(
                participant(settled, winner, true, 100),
                participant(settled, loser, false, 0)));
        givenNoSentLogs();
        givenNoSettings();
        givenAllSendsSucceed();

        PushDispatchSummaryResponse summary = service.sendBetResultNotifications(NOW);

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.sentCount()).isEqualTo(2);
        assertThat(summary.dedupedCount()).isZero();
        assertThat(capturedMessages()).extracting(PushMessage::body).containsExactlyInAnyOrder(
                "내기에서 이겼어요! +100코인 🎉",
                "아쉬워요 — 목표 미달성으로 참가비 50코인을 잃었어요");
    }

    @Test
    @DisplayName("몰수 내기는 참가자 전원에게 소멸 문구 — 달성 플래그와 무관하다")
    void composesForfeitedBodyForEveryone() {
        GroupChallengeBet forfeited = bet(GroupBetStatus.FORFEITED, 30);
        User first = user(UUID.randomUUID());
        User second = user(UUID.randomUUID());
        givenBets(List.of(forfeited), List.of(
                participant(forfeited, first, false, 0),
                participant(forfeited, second, false, 0)));
        givenNoSentLogs();
        givenNoSettings();
        givenAllSendsSucceed();

        service.sendBetResultNotifications(NOW);

        assertThat(capturedMessages()).extracting(PushMessage::body)
                .containsOnly("아무도 목표를 달성하지 못해 참가비가 소멸됐어요");
    }

    @Test
    @DisplayName("푸시 payload 에 딥링크와 종류(type·groupId)가 실린다 — 앱 A3 소비 계약")
    void carriesDeepLinkAndTypeInData() {
        GroupChallengeBet settled = bet(GroupBetStatus.SETTLED, 10);
        User winner = user(UUID.randomUUID());
        givenBets(List.of(settled), List.of(participant(settled, winner, true, 20)));
        givenNoSentLogs();
        givenNoSettings();
        givenAllSendsSucceed();

        service.sendBetResultNotifications(NOW);

        PushMessage message = capturedMessages().get(0);
        assertThat(message.link()).isEqualTo("gromo://group?g=" + GROUP_ID);
        assertThat(message.data()).containsEntry("type", "BET_RESULT")
                .containsEntry("groupId", GROUP_ID.toString());
        assertThat(message.toDataPayload()).containsEntry("link", "gromo://group?g=" + GROUP_ID);
    }

    @Test
    @DisplayName("이미 보낸 (유저, 내기) 는 재실행에서 dedup — 발송 0건")
    void skipsAlreadySentCombinations() {
        GroupChallengeBet settled = bet(GroupBetStatus.SETTLED, 50);
        User winner = user(UUID.randomUUID());
        givenBets(List.of(settled), List.of(participant(settled, winner, true, 50)));
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_BET_RESULT), anyList(), any()))
                .willReturn(List.of(NotificationSentLog.builder()
                        .userId(winner.getId())
                        .type(NotificationSentLog.TYPE_BET_RESULT)
                        .targetUserId(settled.getId())
                        .sentAt(NOW.minusSeconds(60))
                        .build()));

        PushDispatchSummaryResponse summary = service.sendBetResultNotifications(NOW);

        assertThat(summary.sentCount()).isZero();
        assertThat(summary.dedupedCount()).isEqualTo(1);
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("quiet hours 등으로 발송이 안 되면 sent_log 를 남기지 않는다 — 다음 크론이 재시도")
    void doesNotLogWhenNotSent() {
        GroupChallengeBet settled = bet(GroupBetStatus.SETTLED, 50);
        User winner = user(UUID.randomUUID());
        givenBets(List.of(settled), List.of(participant(settled, winner, true, 50)));
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOW))).willReturn(false);

        PushDispatchSummaryResponse summary = service.sendBetResultNotifications(NOW);

        assertThat(summary.sentCount()).isZero();
        assertThat(summary.skippedCount()).isEqualTo(1);
        assertThat(savedLogs()).isEmpty();
    }

    @Test
    @DisplayName("발송 성사 건만 sent_log 로 저장된다 — targetUserId 는 betId")
    void savesLogForSentOnly() {
        GroupChallengeBet settled = bet(GroupBetStatus.SETTLED, 50);
        User winner = user(UUID.randomUUID());
        givenBets(List.of(settled), List.of(participant(settled, winner, true, 50)));
        givenNoSentLogs();
        givenNoSettings();
        givenAllSendsSucceed();

        service.sendBetResultNotifications(NOW);

        assertThat(savedLogs()).singleElement().satisfies(saved -> {
            assertThat(saved.getUserId()).isEqualTo(winner.getId());
            assertThat(saved.getType()).isEqualTo(NotificationSentLog.TYPE_BET_RESULT);
            assertThat(saved.getTargetUserId()).isEqualTo(settled.getId());
            assertThat(saved.getSentAt()).isEqualTo(NOW);
        });
    }

    @Test
    @DisplayName("탈퇴한 유저는 발송 대상에서 빠진다")
    void skipsDeletedUsers() {
        GroupChallengeBet settled = bet(GroupBetStatus.SETTLED, 50);
        User deleted = User.builder()
                .id(UUID.randomUUID()).nickname("탈퇴").deviceToken("t").isDeleted(true).build();
        givenBets(List.of(settled), List.of(participant(settled, deleted, true, 50)));

        PushDispatchSummaryResponse summary = service.sendBetResultNotifications(NOW);

        assertThat(summary.targetCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("최근 정산 건이 없으면 아무 조회도 더 하지 않는다")
    void returnsEmptySummaryWhenNoSettlements() {
        given(groupChallengeBetRepository.findByStatusInAndSettledAtSince(anyCollection(), any()))
                .willReturn(List.of());

        PushDispatchSummaryResponse summary = service.sendBetResultNotifications(NOW);

        assertThat(summary.targetCount()).isZero();
        assertThat(summary.sentCount()).isZero();
        verify(groupChallengeBetParticipantRepository, never()).findByBetIdIn(anyCollection());
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("대상 상태는 SETTLED·FORFEITED 뿐 — CANCELED 는 결과가 아니라 조회에 넣지 않는다")
    void queriesOnlyResultStatuses() {
        given(groupChallengeBetRepository.findByStatusInAndSettledAtSince(anyCollection(), any()))
                .willReturn(List.of());

        service.sendBetResultNotifications(NOW);

        ArgumentCaptor<Collection<GroupBetStatus>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(groupChallengeBetRepository).findByStatusInAndSettledAtSince(captor.capture(), any());
        assertThat(captor.getValue())
                .containsExactlyInAnyOrder(GroupBetStatus.SETTLED, GroupBetStatus.FORFEITED);
    }

    @SuppressWarnings("unchecked")
    private List<NotificationSentLog> savedLogs() {
        ArgumentCaptor<List<NotificationSentLog>> captor = ArgumentCaptor.forClass(List.class);
        verify(notificationSentLogRepository).saveAll(captor.capture());
        return captor.getValue();
    }
}

package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotRepository;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class RankOvertakeNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Instant NOW = Instant.parse("2026-07-06T10:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 6);
    private static final LocalDate YESTERDAY = LocalDate.of(2026, 7, 5);
    private static final LocalDate WEEK_START_DATE = LocalDate.of(2026, 7, 6);
    private static final Instant WEEK_START = WEEK_START_DATE.atStartOfDay(KST).toInstant();
    private static final Instant BEFORE_TODAY = Instant.parse("2026-07-04T00:00:00Z");

    private final UUID meId = UUID.randomUUID();
    private final UUID r1Id = UUID.randomUUID();
    private final UUID r2Id = UUID.randomUUID();
    private final UUID bottomId = UUID.randomUUID();

    @Mock
    private LeagueRankingQueryRepository leagueRankingQueryRepository;
    @Mock
    private LeagueRankSnapshotRepository leagueRankSnapshotRepository;
    @Mock
    private FocusSessionRepository focusSessionRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @Mock
    private LeagueWeek leagueWeek;
    @InjectMocks
    private RankOvertakeNotificationService service;

    @BeforeEach
    void setUp() {
        lenient().when(leagueWeek.currentDate(NOW)).thenReturn(TODAY);
        lenient().when(leagueWeek.currentWeekStartDate(NOW)).thenReturn(WEEK_START_DATE);
        lenient().when(leagueWeek.currentWeekStart(NOW)).thenReturn(WEEK_START);
    }

    private static User user(UUID id, String nickname, Instant lastActiveAt) {
        return User.builder()
                .id(id)
                .nickname(nickname)
                .deviceToken("token-" + id)
                .lastActiveAt(lastActiveAt)
                .build();
    }

    private static LeagueRankingRow row(User user, int totalFocusSeconds) {
        return new LeagueRankingRow(user.getId(), user.getNickname(), 1, totalFocusSeconds);
    }

    private static LeagueRankSnapshot snapshot(UUID userId, int rank, LocalDate day) {
        return LeagueRankSnapshot.builder().userId(userId).rank(rank).createdAt(day).build();
    }

    private User setUpDefaultScenario() {
        User me = user(meId, "나", BEFORE_TODAY);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        User r2 = user(r2Id, "라이벌투", BEFORE_TODAY);
        User bottom = user(bottomId, "꼴찌", BEFORE_TODAY);
        given(leagueRankingQueryRepository.findTop(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), eq(Integer.MAX_VALUE)))
                .willReturn(List.of(row(r1, 400), row(r2, 300), row(me, 200), row(bottom, 0)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection()))
                .willReturn(List.of(me, r1, r2, bottom));
        given(leagueRankSnapshotRepository.findByCreatedAt(YESTERDAY)).willReturn(List.of(
                snapshot(meId, 1, YESTERDAY),
                snapshot(bottomId, 2, YESTERDAY),
                snapshot(r1Id, 3, YESTERDAY),
                snapshot(r2Id, 4, YESTERDAY)));
        given(leagueRankSnapshotRepository.findByCreatedAt(TODAY)).willReturn(List.of());
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());
        lenient().when(userNotificationSettingsRepository.findAllById(any())).thenReturn(List.of(
                UserNotificationSettings.builder().userId(meId).soundEnabled(true).build()));
        lenient().when(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).thenReturn(true);
        return me;
    }

    @Test
    @DisplayName("전역 랭킹에서 어제 아래였던 두 사용자가 오늘 위면 "
            + "한 건의 추월 알림으로 묶는다")
    void detectsGlobalOvertakesAndBundlesRivals() {
        User me = setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(1)).sendIfAllowed(eq(me), any(), message.capture(), eq(NOW));
        assertThat(message.getValue().title()).isEqualTo("라이벌원님 외 1명한테 순위 뺏겼어요!");
        assertThat(message.getValue().body()).isEqualTo("잠깐 집중해서 다시 제쳐볼까요?");
        assertThat(message.getValue().link()).isEqualTo("gromo://league");
        verify(leagueRankingQueryRepository).findTop(
                WEEK_START_DATE, TODAY, null, Integer.MAX_VALUE);
    }

    @Test
    @DisplayName("전역 최하위 사용자는 추월당해도 발송하지 않는다")
    void suppressesLastPlace() {
        User me = user(meId, "나", BEFORE_TODAY);
        User rival = user(r1Id, "라이벌", BEFORE_TODAY);
        given(leagueRankingQueryRepository.findTop(any(), any(), isNull(), eq(Integer.MAX_VALUE)))
                .willReturn(List.of(row(rival, 10), row(me, 0)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(me, rival));
        given(leagueRankSnapshotRepository.findByCreatedAt(YESTERDAY))
                .willReturn(List.of(snapshot(meId, 1, YESTERDAY), snapshot(r1Id, 2, YESTERDAY)));
        given(leagueRankSnapshotRepository.findByCreatedAt(TODAY)).willReturn(List.of());
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("오늘 접속한 사용자는 추월 알림을 받지 않는다")
    void suppressesActiveToday() {
        setUpDefaultScenario();
        User activeMe = user(meId, "나", NOW);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        User r2 = user(r2Id, "라이벌투", BEFORE_TODAY);
        User bottom = user(bottomId, "꼴찌", BEFORE_TODAY);
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection()))
                .willReturn(List.of(activeMe, r1, r2, bottom));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("오늘 집중한 사용자는 추월 알림을 받지 않는다")
    void suppressesFocusedToday() {
        setUpDefaultScenario();
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyCollection(), any(), any()))
                .willReturn(List.of(meId));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("다음 주차 경계까지 12시간 이내면 추월 알림을 발송하지 않는다")
    void suppressesNearDeadline() {
        Instant sundayEvening = Instant.parse("2026-07-05T10:00:00Z");
        LocalDate sunday = LocalDate.of(2026, 7, 5);
        LocalDate monday = LocalDate.of(2026, 6, 29);
        Instant mondayStart = monday.atStartOfDay(KST).toInstant();
        User me = user(meId, "나", BEFORE_TODAY);
        User rival = user(r1Id, "라이벌", BEFORE_TODAY);
        User bottom = user(bottomId, "꼴찌", BEFORE_TODAY);
        given(leagueWeek.currentDate(sundayEvening)).willReturn(sunday);
        given(leagueWeek.currentWeekStartDate(sundayEvening)).willReturn(monday);
        given(leagueWeek.currentWeekStart(sundayEvening)).willReturn(mondayStart);
        given(leagueRankingQueryRepository.findTop(eq(monday), eq(sunday), isNull(), eq(Integer.MAX_VALUE)))
                .willReturn(List.of(row(rival, 20), row(me, 10), row(bottom, 0)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(me, rival, bottom));
        given(leagueRankSnapshotRepository.findByCreatedAt(sunday.minusDays(1))).willReturn(List.of(
                snapshot(meId, 1, sunday.minusDays(1)),
                snapshot(bottomId, 2, sunday.minusDays(1)),
                snapshot(r1Id, 3, sunday.minusDays(1))));
        given(leagueRankSnapshotRepository.findByCreatedAt(sunday)).willReturn(List.of());
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(sundayEvening);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("같은 대표 라이벌에 대한 48시간 쿨다운을 적용한다")
    void suppressesRivalCooldown() {
        setUpDefaultScenario();
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of(NotificationSentLog.builder()
                        .userId(meId)
                        .type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                        .targetUserId(r1Id)
                        .sentAt(NOW.minusSeconds(24 * 3600))
                        .build()));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("주간 추월 알림이 이미 두 번 발송됐으면 상한을 적용한다")
    void suppressesWeeklyCap() {
        setUpDefaultScenario();
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of(
                        sentLog(UUID.randomUUID(), WEEK_START.plusSeconds(3600)),
                        sentLog(UUID.randomUUID(), WEEK_START.plusSeconds(7200))));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("실제로 발송된 추월 알림만 대표 라이벌과 함께 기록한다")
    void logsOnlySentNotification() {
        setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<NotificationSentLog>> logs = ArgumentCaptor.forClass(List.class);
        verify(notificationSentLogRepository).saveAll(logs.capture());
        assertThat(logs.getValue()).singleElement().satisfies(logEntry -> {
            assertThat(logEntry.getUserId()).isEqualTo(meId);
            assertThat(logEntry.getTargetUserId()).isEqualTo(r1Id);
            assertThat(logEntry.getSentAt()).isEqualTo(NOW);
        });
    }

    @Test
    @DisplayName("오늘 전역 순위 스냅샷은 userId와 날짜로 신규 저장하고 기존 행은 갱신한다")
    void upsertsGlobalSnapshots() {
        setUpDefaultScenario();
        LeagueRankSnapshot existing = snapshot(r1Id, 99, TODAY);
        given(leagueRankSnapshotRepository.findByCreatedAt(TODAY)).willReturn(List.of(existing));

        service.sendRankOvertakeNotifications(NOW);

        assertThat(existing.getRank()).isEqualTo(1);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LeagueRankSnapshot>> snapshots = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotRepository).saveAll(snapshots.capture());
        assertThat(snapshots.getValue()).hasSize(3)
                .extracting(LeagueRankSnapshot::getUserId, LeagueRankSnapshot::getRank)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(r2Id, 2),
                        org.assertj.core.groups.Tuple.tuple(meId, 3),
                        org.assertj.core.groups.Tuple.tuple(bottomId, 4));
        assertThat(snapshots.getValue()).allSatisfy(snapshot ->
                assertThat(snapshot.getCreatedAt()).isEqualTo(TODAY));
    }

    @Test
    @DisplayName("어제 스냅샷이 없으면 발송 없이 오늘 전역 순위만 저장한다")
    void bootstrapsWithoutSending() {
        setUpDefaultScenario();
        given(leagueRankSnapshotRepository.findByCreatedAt(YESTERDAY)).willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LeagueRankSnapshot>> snapshots = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotRepository).saveAll(snapshots.capture());
        assertThat(snapshots.getValue()).hasSize(4);
    }

    @Test
    @DisplayName("전역 랭킹 User를 한 번에 조회하고 발송 대상 설정도 한 번에 조회한다")
    void loadsUsersAndSettingsInBatch() {
        setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        verify(userRepository, times(1)).findAllByIdInAndIsDeletedFalse(anyCollection());
        verify(userNotificationSettingsRepository, times(1)).findAllById(any());
        verify(userRepository, never()).findById(any());
        verify(userNotificationSettingsRepository, never()).findById(any());
    }

    private NotificationSentLog sentLog(UUID targetUserId, Instant sentAt) {
        return NotificationSentLog.builder()
                .userId(meId)
                .type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                .targetUserId(targetUserId)
                .sentAt(sentAt)
                .build();
    }
}

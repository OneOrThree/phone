package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.repository.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotRepository;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository.SnapshotRank;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
    private static final Instant NOW = Instant.parse("2026-07-07T10:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 7);
    private static final LocalDate YESTERDAY = LocalDate.of(2026, 7, 6);
    private static final LocalDate WEEK_START_DATE = LocalDate.of(2026, 7, 6);
    private static final Instant WEEK_START = WEEK_START_DATE.atStartOfDay(KST).toInstant();
    private static final Instant BEFORE_TODAY = Instant.parse("2026-07-04T00:00:00Z");
    private static final int FETCH_SIZE = RankOvertakeNotificationService.NOTIFICATION_PAGE_SIZE + 1;

    private final UUID meId = UUID.randomUUID();
    private final UUID r1Id = UUID.randomUUID();
    private final UUID r2Id = UUID.randomUUID();
    private final UUID bottomId = UUID.randomUUID();

    @Mock
    private LeagueRankingQueryRepository leagueRankingQueryRepository;
    @Mock
    private LeagueRankSnapshotRepository leagueRankSnapshotRepository;
    @Mock
    private LeagueRankSnapshotUpsertRepository leagueRankSnapshotUpsertRepository;
    @Mock
    private FocusSessionRepository focusSessionRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @Mock
    private LeagueWeek leagueWeek;
    @Mock
    private EntityManager entityManager;

    private RankOvertakeNotificationService service;

    /**
     * 서비스는 테스트마다 새로 조립한다 — {@code @InjectMocks} 로는 아래 {@code legacyDispatcher}
     * 처럼 «목이 아닌 실물»을 끼워 넣을 수 없다.
     */
    @BeforeEach
    void assembleService() {
        service = new RankOvertakeNotificationService(
                leagueRankingQueryRepository,
                leagueRankSnapshotRepository,
                leagueRankSnapshotUpsertRepository,
                focusSessionRepository,
                userQueryService,
                notificationSentLogRepository,
                pushNotificationService,
                legacyDispatcher(pushNotificationService),
                leagueWeek,
                entityManager);
    }

    /**
     * 구 경로로 고정한 dispatcher — 이 테스트가 검증하는 것은 {@code LEGACY} 동작이다.
     *
     * <p>producer 를 {@code null} 로 둔다. 신 경로로 새면 곧바로 NPE 로 죽으므로, 기본 모드가
     * 실수로 {@code OUTBOX} 로 바뀌면 이 테스트가 «조용히 통과»하지 않고 터진다.
     *
     * @param pushNotificationService 목으로 둔 발송부
     * @return 구 경로 dispatcher
     */
    private static NotificationDispatcher legacyDispatcher(PushNotificationService pushNotificationService) {
        return new NotificationDispatcher(new NotificationDispatchProperties(), null, pushNotificationService);
    }

    @BeforeEach
    void setUp() {
        lenient().when(leagueWeek.currentDate(NOW)).thenReturn(TODAY);
        lenient().when(leagueWeek.currentWeekStartDate(NOW)).thenReturn(WEEK_START_DATE);
        lenient().when(leagueWeek.currentWeekStart(NOW)).thenReturn(WEEK_START);
        lenient().when(leagueRankSnapshotRepository.findMaximumRankByCreatedAt(YESTERDAY)).thenReturn(4);
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
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(row(r1, 400), row(r2, 300), row(me, 200), row(bottom, 0)));
        given(userQueryService.findAllActive(anyCollection()))
                .willReturn(List.of(me, r1, r2, bottom));
        lenient().when(leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(eq(YESTERDAY), anyCollection()))
                .thenReturn(List.of(
                        snapshot(meId, 1, YESTERDAY),
                        snapshot(bottomId, 2, YESTERDAY),
                        snapshot(r1Id, 3, YESTERDAY),
                        snapshot(r2Id, 4, YESTERDAY)));
        // 기본 시나리오는 '오늘 아무도 집중하지 않음' — 고아/취소 세션만 있는 유저도 여기 해당한다 (GROMO-851)
        lenient().when(focusSessionRepository
                        .findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .thenReturn(List.of());
        lenient().when(focusSessionRepository.findUserIdsWithLiveSession(anyCollection(), any()))
                .thenReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());
        lenient().when(userQueryService.findAllNotificationSettings(any())).thenReturn(List.of(
                UserNotificationSettings.builder().userId(meId).soundEnabled(true).build()));
        lenient().when(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).thenReturn(true);
        return me;
    }

    @Test
    @DisplayName("전역 랭킹에서 어제 아래였던 두 사용자가 오늘 위면 한 건으로 묶는다")
    void detectsGlobalOvertakesAndBundlesRivals() {
        User me = setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(me), any(), message.capture(), eq(NOW));
        assertThat(message.getValue().title()).contains("라이벌원님", "외 1명", "순위");
        verify(leagueRankingQueryRepository).findGlobalRankingPage(
                WEEK_START_DATE, TODAY, null, null, FETCH_SIZE);
        verify(entityManager).flush();
        verify(entityManager).clear();
    }

    @Test
    @DisplayName("전역 최하위 행은 snapshot에 포함하지만 추월 알림은 판정하지 않는다")
    void suppressesLastPlaceButUpsertsSnapshot() {
        User me = user(meId, "나", BEFORE_TODAY);
        User rival = user(r1Id, "라이벌", BEFORE_TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(any(), any(), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(row(rival, 10), row(me, 0)));
        given(userQueryService.findAllActive(anyCollection())).willReturn(List.of(me, rival));
        given(leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(eq(YESTERDAY), anyCollection()))
                .willReturn(List.of(snapshot(meId, 1, YESTERDAY), snapshot(r1Id, 2, YESTERDAY)));
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SnapshotRank>> snapshots = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotUpsertRepository).upsertAll(eq(TODAY), snapshots.capture());
        assertThat(snapshots.getValue()).extracting(SnapshotRank::userId, SnapshotRank::rank)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(r1Id, 1),
                        org.assertj.core.groups.Tuple.tuple(meId, 2));
    }

    @Test
    @DisplayName("페이지 경계 다음의 전역 마지막 행도 snapshot만 upsert하고 알림은 건너뛴다")
    void lastGlobalRowAcrossPageBoundaryOnlyUpsertsSnapshot() {
        int pageSize = RankOvertakeNotificationService.NOTIFICATION_PAGE_SIZE;
        List<User> users = new ArrayList<>();
        List<LeagueRankingRow> fetched = new ArrayList<>();
        for (int index = 0; index <= pageSize; index++) {
            User current = user(UUID.randomUUID(), "user-" + index, BEFORE_TODAY);
            users.add(current);
            fetched.add(row(current, pageSize - index));
        }
        User first = users.get(0);
        User last = users.get(pageSize);
        LeagueRankingRow pageCursor = fetched.get(pageSize - 1);
        Map<UUID, User> usersById = new HashMap<>();
        users.forEach(current -> usersById.put(current.getId(), current));
        given(leagueRankSnapshotRepository.findMaximumRankByCreatedAt(YESTERDAY)).willReturn(2);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                WEEK_START_DATE, TODAY, null, null, FETCH_SIZE)).willReturn(fetched);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                WEEK_START_DATE,
                TODAY,
                pageCursor.totalFocusSeconds(),
                pageCursor.userId(),
                FETCH_SIZE)).willReturn(List.of(fetched.get(pageSize)));
        given(userQueryService.findAllActive(anyCollection())).willAnswer(invocation -> {
            Collection<UUID> ids = invocation.getArgument(0);
            return ids.stream().map(usersById::get).toList();
        });
        given(leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(eq(YESTERDAY), anyCollection()))
                .willAnswer(invocation -> {
                    Collection<UUID> ids = invocation.getArgument(1);
                    List<LeagueRankSnapshot> result = new ArrayList<>();
                    if (ids.contains(first.getId())) {
                        result.add(snapshot(first.getId(), 2, YESTERDAY));
                    }
                    if (ids.contains(last.getId())) {
                        result.add(snapshot(last.getId(), 1, YESTERDAY));
                    }
                    return result;
                });
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SnapshotRank>> snapshots = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotUpsertRepository, times(2)).upsertAll(eq(TODAY), snapshots.capture());
        assertThat(snapshots.getAllValues().get(1)).containsExactly(new SnapshotRank(last.getId(), pageSize + 1));
        verify(entityManager, times(2)).clear();
    }

    @Test
    @DisplayName("페이지 경계 밖 사용자의 양수 추월을 이전 페이지 라이벌과 비교한다")
    void detectsPositiveOvertakeAcrossPageBoundary() {
        int pageSize = RankOvertakeNotificationService.NOTIFICATION_PAGE_SIZE;
        List<User> users = new ArrayList<>();
        List<LeagueRankingRow> fetched = new ArrayList<>();
        for (int index = 0; index <= pageSize + 1; index++) {
            User current = user(UUID.randomUUID(), "user-" + index, BEFORE_TODAY);
            users.add(current);
            fetched.add(row(current, pageSize + 1 - index));
        }
        User first = users.get(0);
        User candidate = users.get(pageSize);
        LeagueRankingRow pageCursor = fetched.get(pageSize - 1);
        Map<UUID, User> usersById = new HashMap<>();
        users.forEach(current -> usersById.put(current.getId(), current));
        given(leagueRankSnapshotRepository.findMaximumRankByCreatedAt(YESTERDAY)).willReturn(2);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                WEEK_START_DATE, TODAY, null, null, FETCH_SIZE)).willReturn(fetched.subList(0, FETCH_SIZE));
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                WEEK_START_DATE,
                TODAY,
                pageCursor.totalFocusSeconds(),
                pageCursor.userId(),
                FETCH_SIZE)).willReturn(fetched.subList(pageSize, pageSize + 2));
        given(userQueryService.findAllActive(anyCollection())).willAnswer(invocation -> {
            Collection<UUID> ids = invocation.getArgument(0);
            return ids.stream().map(usersById::get).toList();
        });
        given(leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(eq(YESTERDAY), anyCollection()))
                .willAnswer(invocation -> {
                    Collection<UUID> ids = invocation.getArgument(1);
                    List<LeagueRankSnapshot> result = new ArrayList<>();
                    if (ids.contains(first.getId())) {
                        result.add(snapshot(first.getId(), 2, YESTERDAY));
                    }
                    if (ids.contains(candidate.getId())) {
                        result.add(snapshot(candidate.getId(), 1, YESTERDAY));
                    }
                    return result;
                });
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());
        given(userQueryService.findAllNotificationSettings(any())).willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService).sendIfAllowed(eq(candidate), any(), any(), eq(NOW));
    }

    @Test
    @DisplayName("전체 건수가 페이지 크기의 배수여도 마지막 행은 snapshot만 저장한다")
    void exactPageMultipleStillSuppressesLastPlace() {
        int pageSize = RankOvertakeNotificationService.NOTIFICATION_PAGE_SIZE;
        List<User> users = new ArrayList<>();
        List<LeagueRankingRow> ranking = new ArrayList<>();
        for (int index = 0; index < pageSize; index++) {
            User current = user(UUID.randomUUID(), "user-" + index, BEFORE_TODAY);
            users.add(current);
            ranking.add(row(current, pageSize - index));
        }
        User first = users.get(0);
        User last = users.get(pageSize - 1);
        given(leagueRankSnapshotRepository.findMaximumRankByCreatedAt(YESTERDAY)).willReturn(2);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                WEEK_START_DATE, TODAY, null, null, FETCH_SIZE)).willReturn(ranking);
        given(userQueryService.findAllActive(anyCollection())).willReturn(users);
        given(leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(eq(YESTERDAY), anyCollection()))
                .willReturn(List.of(
                        snapshot(first.getId(), 2, YESTERDAY),
                        snapshot(last.getId(), 1, YESTERDAY)));
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SnapshotRank>> snapshots = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotUpsertRepository).upsertAll(eq(TODAY), snapshots.capture());
        assertThat(snapshots.getValue().get(pageSize - 1))
                .isEqualTo(new SnapshotRank(last.getId(), pageSize));
    }

    @Test
    @DisplayName("오늘 접속한 사용자는 추월 알림을 받지 않는다")
    void suppressesActiveToday() {
        setUpDefaultScenario();
        User activeMe = user(meId, "나", NOW);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        User r2 = user(r2Id, "라이벌투", BEFORE_TODAY);
        User bottom = user(bottomId, "꼴찌", BEFORE_TODAY);
        given(userQueryService.findAllActive(anyCollection()))
                .willReturn(List.of(activeMe, r1, r2, bottom));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("오늘 완료된 집중 세션이 있는 사용자는 추월 알림을 받지 않는다")
    void suppressesCompletedFocusToday() {
        setUpDefaultScenario();
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of(meId));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        // 완료 판정 창은 KST 하루 [오늘 0시, 내일 0시) — 절대시각이라 비-KST 유저에도 동일하게 적용된다
        verify(focusSessionRepository).findUserIdsWithCompletedFocusEndedBetween(
                anyCollection(),
                eq(TODAY.atStartOfDay(KST).toInstant()),
                eq(TODAY.plusDays(1).atStartOfDay(KST).toInstant()));
    }

    @Test
    @DisplayName("지금 집중 중(라이브)인 사용자는 추월 알림을 받지 않는다")
    void suppressesLiveSession() {
        setUpDefaultScenario();
        given(focusSessionRepository.findUserIdsWithLiveSession(anyCollection(), any()))
                .willReturn(List.of(meId));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        // 라이브 하한 = now - 12h(ORPHAN_TIMEOUT). 하한이 없으면 스윕 대기 중인 버려진 세션까지 '라이브'로 잡혀 과억제된다
        verify(focusSessionRepository).findUserIdsWithLiveSession(
                anyCollection(), eq(NOW.minus(Duration.ofHours(12))));
    }

    @Test
    @DisplayName("고아 자동종료 세션만 있는 사용자에게는 추월 알림을 보낸다 (GROMO-851 회귀)")
    void sendsToUserWithOnlyOrphanSession() {
        User me = setUpDefaultScenario();
        // 고아(AUTO_CLOSED)·취소(CANCELED) 세션은 실집중 0분이라 완료·라이브 어느 조회에도 잡히지 않는다.
        // 과거 startedAt 기준에서는 '오늘 집중함'으로 오판돼 이 유저가 넛지를 받지 못했다.
        // ⚠️ 이 테스트 자체는 pre-fix 구현도 통과한다(startedAt 스텁이 빈 결과였으므로) — 구조적 회귀 방지는
        //    startedAt 쿼리를 리포지토리에서 삭제해 컴파일러가 막는 쪽이고, 여기서는 '어떤 신호를 보고
        //    무엇을 판단하는지'를 인자 검증(위 두 테스트)과 함께 고정한다.
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(focusSessionRepository.findUserIdsWithLiveSession(anyCollection(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService).sendIfAllowed(eq(me), any(), any(), eq(NOW));
    }

    @Test
    @DisplayName("같은 대표 라이벌에 대한 48시간 쿨다운을 적용한다")
    void suppressesRivalCooldown() {
        setUpDefaultScenario();
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of(sentLog(r1Id, NOW.minusSeconds(24 * 3600))));

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
        given(leagueRankSnapshotRepository.findMaximumRankByCreatedAt(sunday.minusDays(1))).willReturn(3);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(monday), eq(sunday), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(row(rival, 20), row(me, 10), row(bottom, 0)));
        given(userQueryService.findAllActive(anyCollection())).willReturn(List.of(me, rival, bottom));
        given(leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(
                eq(sunday.minusDays(1)), anyCollection())).willReturn(List.of(
                        snapshot(meId, 1, sunday.minusDays(1)),
                        snapshot(bottomId, 2, sunday.minusDays(1)),
                        snapshot(r1Id, 3, sunday.minusDays(1))));
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(sundayEvening);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("실제 발송된 추월 알림만 대표 라이벌과 함께 기록한다")
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
    @DisplayName("어제 snapshot이 없으면 발송 없이 오늘 전역 순위만 원자적 upsert한다")
    void bootstrapsWithoutSending() {
        setUpDefaultScenario();
        given(leagueRankSnapshotRepository.findMaximumRankByCreatedAt(YESTERDAY)).willReturn(0);
        given(leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(eq(YESTERDAY), anyCollection()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SnapshotRank>> snapshots = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotUpsertRepository).upsertAll(eq(TODAY), snapshots.capture());
        assertThat(snapshots.getValue()).hasSize(4);
    }

    @Test
    @DisplayName("주차 첫날은 직전 주 일요일 snapshot과 비교하지 않고 오늘 순위만 seed한다")
    void firstDayOfWeekSeedsWithoutComparingPreviousWeek() {
        Instant mondayNow = Instant.parse("2026-07-06T10:00:00Z");
        LocalDate monday = LocalDate.of(2026, 7, 6);
        User first = user(r1Id, "첫째", BEFORE_TODAY);
        User second = user(meId, "둘째", BEFORE_TODAY);
        given(leagueWeek.currentDate(mondayNow)).willReturn(monday);
        given(leagueWeek.currentWeekStartDate(mondayNow)).willReturn(monday);
        given(leagueWeek.currentWeekStart(mondayNow)).willReturn(WEEK_START);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                monday, monday, null, null, FETCH_SIZE)).willReturn(List.of(row(first, 10), row(second, 0)));
        given(userQueryService.findAllActive(anyCollection())).willReturn(List.of(first, second));
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());

        service.sendRankOvertakeNotifications(mondayNow);

        verify(leagueRankSnapshotRepository, never()).findMaximumRankByCreatedAt(any());
        verify(leagueRankSnapshotRepository, never()).findByCreatedAtAndUserIdIn(any(), anyCollection());
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SnapshotRank>> snapshots = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotUpsertRepository).upsertAll(eq(monday), snapshots.capture());
        assertThat(snapshots.getValue()).containsExactly(
                new SnapshotRank(r1Id, 1), new SnapshotRank(meId, 2));
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

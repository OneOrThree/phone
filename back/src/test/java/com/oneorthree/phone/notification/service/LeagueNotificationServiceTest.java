package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
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
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class LeagueNotificationServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-06T00:00:00Z");
    private static final Instant PREVIOUS_WEEK_START = Instant.parse("2026-06-28T15:00:00Z");
    private static final LocalDate WEEK_START_DATE = LocalDate.of(2026, 7, 6);
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 6);
    private static final int FETCH_SIZE = LeagueNotificationService.NOTIFICATION_PAGE_SIZE + 1;

    @Mock
    private LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    @Mock
    private LeagueRankingQueryRepository leagueRankingQueryRepository;
    @Mock
    private LeagueTierConfigRepository leagueTierConfigRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @Mock
    private LeagueWeek leagueWeek;
    @Mock
    private EntityManager entityManager;
    @InjectMocks
    private LeagueNotificationService service;

    @BeforeEach
    void setUp() {
        lenient().when(leagueWeek.previousWeekStart(NOW)).thenReturn(PREVIOUS_WEEK_START);
    }

    private static User user(UUID id) {
        return User.builder().id(id).deviceToken("token-" + id).build();
    }

    private static LeagueWeeklyResult result(
            User user, LeagueWeeklyResultType type, int previousTier, int newTier) {
        return LeagueWeeklyResult.builder()
                .user(user)
                .weekStartAt(PREVIOUS_WEEK_START)
                .previousTierLevel(previousTier)
                .newTierLevel(newTier)
                .result(type)
                .build();
    }

    @Test
    @DisplayName("직전 주간 정산의 승격·강등 결과와 이전/새 티어로 알림 문구를 만든다")
    void sendsWeeklyResultsFromGlobalSettlement() {
        User promoted = user(UUID.randomUUID());
        User relegated = user(UUID.randomUUID());
        given(leagueWeeklyResultRepository.findByWeekStartAtAndResultIn(any(), anyCollection()))
                .willReturn(List.of(
                        result(promoted, LeagueWeeklyResultType.PROMOTED, 2, 3),
                        result(relegated, LeagueWeeklyResultType.RELEGATED, 4, 3)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection()))
                .willReturn(List.of(promoted, relegated));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendWeeklyResultNotifications(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<LeagueWeeklyResultType>> types = ArgumentCaptor.forClass(Collection.class);
        verify(leagueWeeklyResultRepository).findByWeekStartAtAndResultIn(eq(PREVIOUS_WEEK_START), types.capture());
        assertThat(types.getValue())
                .containsExactlyInAnyOrder(LeagueWeeklyResultType.PROMOTED, LeagueWeeklyResultType.RELEGATED);

        ArgumentCaptor<PushMessage> promotedMessage = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(promoted), any(), promotedMessage.capture(), eq(NOW));
        assertThat(promotedMessage.getValue().body()).contains("예열 모드", "초집중 모드");
        assertThat(promotedMessage.getValue().link()).isEqualTo("gromo://league");

        ArgumentCaptor<PushMessage> relegatedMessage = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(relegated), any(), relegatedMessage.capture(), eq(NOW));
        assertThat(relegatedMessage.getValue().body()).contains("갓생러", "초집중 모드");
        assertThat(relegatedMessage.getValue().link()).isEqualTo("gromo://focus");
    }

    @Test
    @DisplayName("주간 결과 대상 User와 알림 설정을 각각 한 번에 조회한다")
    void loadsWeeklyUsersAndSettingsInBatch() {
        User first = user(UUID.randomUUID());
        User second = user(UUID.randomUUID());
        given(leagueWeeklyResultRepository.findByWeekStartAtAndResultIn(any(), anyCollection()))
                .willReturn(List.of(
                        result(first, LeagueWeeklyResultType.PROMOTED, 1, 2),
                        result(second, LeagueWeeklyResultType.RELEGATED, 3, 2)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(first, second));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendWeeklyResultNotifications(NOW);

        verify(userRepository, times(1)).findAllByIdInAndIsDeletedFalse(anyCollection());
        verify(userNotificationSettingsRepository, times(1)).findAllById(any());
        verify(userRepository, never()).findById(any());
        verify(userNotificationSettingsRepository, never()).findById(any());
    }

    @Test
    @DisplayName("주간 결과 알림도 200명 단위로 나눠 User·설정 IN 조회를 제한한다")
    void pagesWeeklyResultsWithoutLargeInClause() {
        int pageSize = LeagueNotificationService.NOTIFICATION_PAGE_SIZE;
        List<LeagueWeeklyResult> results = new ArrayList<>();
        Map<UUID, User> usersById = new HashMap<>();
        for (int index = 0; index <= pageSize; index++) {
            User user = user(UUID.randomUUID());
            usersById.put(user.getId(), user);
            results.add(result(user, LeagueWeeklyResultType.PROMOTED, 1, 2));
        }
        given(leagueWeeklyResultRepository.findByWeekStartAtAndResultIn(any(), anyCollection()))
                .willReturn(results);
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willAnswer(invocation -> {
            Collection<UUID> ids = invocation.getArgument(0);
            return ids.stream().map(usersById::get).toList();
        });
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendWeeklyResultNotifications(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> ids = ArgumentCaptor.forClass(Collection.class);
        verify(userRepository, times(2)).findAllByIdInAndIsDeletedFalse(ids.capture());
        assertThat(ids.getAllValues()).extracting(Collection::size).containsExactly(pageSize, 1);
        verify(pushNotificationService, times(pageSize + 1)).sendIfAllowed(any(), any(), any(), eq(NOW));
        verify(entityManager, times(2)).clear();
    }

    @Test
    @DisplayName("알림 설정의 soundEnabled를 주간 결과 메시지에 반영한다")
    void respectsWeeklySoundSetting() {
        User promoted = user(UUID.randomUUID());
        given(leagueWeeklyResultRepository.findByWeekStartAtAndResultIn(any(), anyCollection()))
                .willReturn(List.of(result(promoted, LeagueWeeklyResultType.PROMOTED, 2, 3)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(promoted));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of(
                UserNotificationSettings.builder().userId(promoted.getId()).soundEnabled(false).build()));

        service.sendWeeklyResultNotifications(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(promoted), any(), message.capture(), eq(NOW));
        assertThat(message.getValue().soundEnabled()).isFalse();
    }

    @Test
    @DisplayName("이번 주 DailyFocusStat 전역 순위와 0초 사용자를 포함해 마감 알림을 발송한다")
    void sendsDeadlineReminderToGlobalRanking() {
        User first = user(UUID.randomUUID());
        User second = user(UUID.randomUUID());
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(
                        new LeagueRankingRow(first.getId(), "첫째", 3, 100),
                        new LeagueRankingRow(second.getId(), "둘째", 2, 0)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(first, second));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendDeadlineReminders(NOW);

        ArgumentCaptor<PushMessage> messages = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(2)).sendIfAllowed(any(), any(), messages.capture(), eq(NOW));
        assertThat(messages.getAllValues()).extracting(PushMessage::body)
                .containsExactly(
                        "지금 1위야. 마지막 스퍼트 한 번 어때?",
                        "지금 2위야. 마지막 스퍼트 한 번 어때?");
        verify(userRepository, times(1)).findAllByIdInAndIsDeletedFalse(anyCollection());
        verify(userNotificationSettingsRepository, times(1)).findAllById(any());
    }

    @Test
    @DisplayName("마감 알림은 limit+1 keyset 페이지로 순위를 유지하고 IN 조회를 200명 이하로 제한한다")
    void pagesDeadlineRemindersWithoutLargeInClause() {
        int pageSize = LeagueNotificationService.NOTIFICATION_PAGE_SIZE;
        List<LeagueRankingRow> fetched = new ArrayList<>();
        Map<UUID, User> usersById = new HashMap<>();
        for (int index = 0; index <= pageSize; index++) {
            User user = user(UUID.randomUUID());
            usersById.put(user.getId(), user);
            fetched.add(new LeagueRankingRow(user.getId(), "user-" + index, 1, pageSize - index));
        }
        LeagueRankingRow pageCursor = fetched.get(pageSize - 1);
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                WEEK_START_DATE, TODAY, null, null, FETCH_SIZE)).willReturn(fetched);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                WEEK_START_DATE,
                TODAY,
                pageCursor.totalFocusSeconds(),
                pageCursor.userId(),
                FETCH_SIZE)).willReturn(List.of(fetched.get(pageSize)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willAnswer(invocation -> {
            Collection<UUID> ids = invocation.getArgument(0);
            return ids.stream().map(usersById::get).toList();
        });
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendDeadlineReminders(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> ids = ArgumentCaptor.forClass(Collection.class);
        verify(userRepository, times(2)).findAllByIdInAndIsDeletedFalse(ids.capture());
        assertThat(ids.getAllValues()).extracting(Collection::size).containsExactly(pageSize, 1);
        ArgumentCaptor<PushMessage> messages = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(pageSize + 1))
                .sendIfAllowed(any(), any(), messages.capture(), eq(NOW));
        assertThat(messages.getAllValues().get(pageSize).body())
                .isEqualTo("지금 201위야. 마지막 스퍼트 한 번 어때?");
        verify(entityManager, times(2)).clear();
    }

    @Test
    @DisplayName("전역 랭킹이 비어 있으면 사용자 조회와 발송을 생략한다")
    void skipsEmptyGlobalRanking() {
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                any(), any(), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of());

        service.sendDeadlineReminders(NOW);

        verify(userRepository, never()).findAllByIdInAndIsDeletedFalse(anyCollection());
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("마감 2시간 전 알림 — 전역 순위 전원에게 '마감 2시간 전' 문구·gromo://focus로 발송한다")
    void sendsFinalDeadlineReminderToGlobalRanking() {
        User first = user(UUID.randomUUID());
        User second = user(UUID.randomUUID());
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(
                        new LeagueRankingRow(first.getId(), "첫째", 3, 100),
                        new LeagueRankingRow(second.getId(), "둘째", 2, 0)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(first, second));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendFinalDeadlineReminders(NOW);

        ArgumentCaptor<PushMessage> messages = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(2)).sendIfAllowed(any(), any(), messages.capture(), eq(NOW));
        assertThat(messages.getAllValues()).extracting(PushMessage::title).containsOnly("마감 2시간 전!");
        assertThat(messages.getAllValues()).extracting(PushMessage::link).containsOnly("gromo://focus");
        assertThat(messages.getAllValues().get(0).body()).isEqualTo("지금 1위야. 마지막 스퍼트 한 번 어때?");
    }

    // ── 위기·마감 시퀀스 (GROMO-840 커밋②): 강등 경고 + 마감 D-1 ─────────────────

    @Test
    @DisplayName("일요일 오전 위기 알림 — 강등 위험/승급 미달/안전권을 유저당 1건으로 분기한다")
    void sendsSundayMorningCrisisBranchedPerUser() {
        User relegationRisk = user(UUID.randomUUID());
        User promotionPending = user(UUID.randomUUID());
        User safe = user(UUID.randomUUID());
        givenCrisisContext(
                List.of(
                        new LeagueRankingRow(relegationRisk.getId(), "강등위험", 3, 90_000),   // < T3 강등 100800
                        new LeagueRankingRow(promotionPending.getId(), "승급대기", 2, 60_000), // T2 강등 50400↑·승급 100800↓
                        new LeagueRankingRow(safe.getId(), "안전", 2, 100_800)),               // ≥ T2 승급 → 무발송
                List.of(relegationRisk, promotionPending, safe));

        service.sendSundayCrisisReminders(NOW);

        ArgumentCaptor<PushMessage> relegMsg = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(relegationRisk), any(), relegMsg.capture(), eq(NOW));
        assertThat(relegMsg.getValue().link()).isEqualTo("gromo://focus");
        assertThat(relegMsg.getValue().title()).contains("강등");

        ArgumentCaptor<PushMessage> promoMsg = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(promotionPending), any(), promoMsg.capture(), eq(NOW));
        assertThat(promoMsg.getValue().link()).isEqualTo("gromo://league");
        assertThat(promoMsg.getValue().body()).contains("승급");

        verify(pushNotificationService, never()).sendIfAllowed(eq(safe), any(), any(), any());
    }

    @Test
    @DisplayName("T1은 강등 임계값이 0이라 강등 경고 대상이 아니고, 승급 미달이면 마감 D-1을 받는다")
    void tierOneNeverRelegatedButGetsDeadlineDMinusOne() {
        User tierOne = user(UUID.randomUUID());
        givenCrisisContext(
                List.of(new LeagueRankingRow(tierOne.getId(), "티어1", 1, 1_000)), // < T1 승급 50400
                List.of(tierOne));

        service.sendSundayCrisisReminders(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(tierOne), any(), message.capture(), eq(NOW));
        assertThat(message.getValue().link()).isEqualTo("gromo://league"); // 마감 D-1
    }

    @Test
    @DisplayName("일요일 저녁 강등 경고 — 강등 위험군만 발송하고 승급 미달(D-1)은 제외한다")
    void sendsSundayEveningRelegationWarningsOnly() {
        User relegationRisk = user(UUID.randomUUID());
        User promotionPending = user(UUID.randomUUID());
        givenCrisisContext(
                List.of(
                        new LeagueRankingRow(relegationRisk.getId(), "강등위험", 3, 90_000),
                        new LeagueRankingRow(promotionPending.getId(), "승급대기", 2, 60_000)),
                List.of(relegationRisk, promotionPending));

        service.sendRelegationWarnings(NOW);

        verify(pushNotificationService).sendIfAllowed(eq(relegationRisk), any(), any(), eq(NOW));
        verify(pushNotificationService, never()).sendIfAllowed(eq(promotionPending), any(), any(), any());
    }

    @Test
    @DisplayName("강등 경고 문구에 부족한 시간을 시간·분으로 표기한다")
    void relegationWarningFormatsShortfall() {
        User relegationRisk = user(UUID.randomUUID());
        givenCrisisContext(
                // T3 강등 100800 − 88200 = 12600초 = 3시간 30분 부족
                List.of(new LeagueRankingRow(relegationRisk.getId(), "강등위험", 3, 88_200)),
                List.of(relegationRisk));

        service.sendSundayCrisisReminders(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(relegationRisk), any(), message.capture(), eq(NOW));
        assertThat(message.getValue().body()).contains("3시간 30분");
    }

    private void givenCrisisContext(List<LeagueRankingRow> rows, List<User> users) {
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueTierConfigRepository.findAll()).willReturn(defaultTierConfigs());
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(rows);
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(users);
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());
    }

    private static List<LeagueTierConfig> defaultTierConfigs() {
        return List.of(
                tierConfig(1, 50_400, 0),
                tierConfig(2, 100_800, 50_400),
                tierConfig(3, 151_200, 100_800),
                tierConfig(4, 201_600, 151_200),
                tierConfig(5, 252_000, 201_600));
    }

    private static LeagueTierConfig tierConfig(int level, int promotion, int relegation) {
        return LeagueTierConfig.builder()
                .tierLevel(level)
                .badgeId("badge-" + level)
                .promotionTime(promotion)
                .relegationTime(relegation)
                .build();
    }
}

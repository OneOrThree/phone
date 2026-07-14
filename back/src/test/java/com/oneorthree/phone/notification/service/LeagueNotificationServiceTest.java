package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
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
}

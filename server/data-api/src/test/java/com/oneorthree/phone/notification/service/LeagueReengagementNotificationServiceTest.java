package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import jakarta.persistence.EntityManager;
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
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class LeagueReengagementNotificationServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-15T12:00:00Z");
    private static final LocalDate WEEK_START_DATE = LocalDate.of(2026, 7, 13);
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 15);
    private static final LocalDate YESTERDAY = TODAY.minusDays(1);
    private static final int FETCH_SIZE = LeagueReengagementNotificationService.NOTIFICATION_PAGE_SIZE + 1;

    @Mock
    private LeagueRankingQueryRepository leagueRankingQueryRepository;
    @Mock
    private FocusSessionRepository focusSessionRepository;
    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;
    @Mock
    private UserStreakRepository userStreakRepository;
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
    private LeagueReengagementNotificationService service;

    private static User user(UUID id) {
        return User.builder().id(id).deviceToken("token-" + id).build();
    }

    private static LeagueRankingRow row(User user, int weeklySeconds) {
        return new LeagueRankingRow(user.getId(), "닉-" + user.getId(), 1, weeklySeconds);
    }

    private static UserStreak streak(UUID userId, int count) {
        return UserStreak.builder().userId(userId).streakCount(count).build();
    }

    private static DailyFocusStat dailyStat(User user, int seconds) {
        return DailyFocusStat.builder().user(user).totalFocusSeconds(seconds).build();
    }

    // ── 오늘 미집중 (평일 21:00) ────────────────────────────────────────────────

    @Test
    @DisplayName("오늘 미집중 — 이번 주 참여(누적>0) & 오늘 0분인 유저에게만 발송한다")
    void sendsMissedFocusOnlyToParticipantsWithoutTodayFocus() {
        User target = user(UUID.randomUUID());       // 참여 O, 오늘 집중 X → 발송
        User focusedToday = user(UUID.randomUUID());  // 참여 O, 오늘 집중 O → 미발송
        User nonParticipant = user(UUID.randomUUID()); // 이번 주 누적 0 → 미발송
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(
                        row(target, 5_000),
                        row(focusedToday, 3_000),
                        row(nonParticipant, 0)));
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of(focusedToday.getId())); // 오늘(KST) 종료된 완료 세션 존재 → 미발송
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(target));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendMissedFocusToday(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(1)).sendIfAllowed(eq(target), any(), message.capture(), eq(NOW));
        assertThat(message.getValue().title()).isEqualTo("오늘 아직 0분!");
        assertThat(message.getValue().link()).isEqualTo("gromo://focus");
    }

    @Test
    @DisplayName("오늘 미집중 — 자정 넘겨 오늘(KST) 종료된 완료 세션은 오늘 집중으로 보고 발송하지 않는다")
    void countsOvernightSessionAsTodayFocus() {
        User overnight = user(UUID.randomUUID()); // 어제 시작·오늘 종료(endedAt KST 오늘 구간) → 오늘 집중 인정 → 미발송
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(row(overnight, 4_000)));
        given(focusSessionRepository.findUserIdsWithCompletedFocusEndedBetween(anyCollection(), any(), any()))
                .willReturn(List.of(overnight.getId())); // endedAt 이 오늘(KST) 구간 → 오늘 집중으로 인정 → 미발송

        service.sendMissedFocusToday(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("오늘 미집중 — 버려진(자동종료) 세션은 실집중 0이라 오늘 집중으로 보지 않고 발송한다")
    void doesNotTreatAutoClosedSessionAsTodayFocus() {
        User orphaned = user(UUID.randomUUID()); // 오늘 세션 시작했으나 orphan 자동종료 → DailyFocusStat 없음, 진행 중 세션 없음
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(row(orphaned, 4_000)));
        // 완료세션(AUTO_CLOSED 는 status 필터로 제외)·라이브세션 조회 모두 미스텁 → 빈 결과 → 실집중 0으로 판정
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(orphaned));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendMissedFocusToday(NOW);

        verify(pushNotificationService, times(1)).sendIfAllowed(eq(orphaned), any(), any(), eq(NOW));
        // 회귀 락 — 재참여 경로는 고아 세션을 '집중함'으로 오판하던 신호(startedAt·DailyFocusStat-date)를 쓰지 않는다.
        // startedAt 쿼리(findUserIdsWithSessionStartedBetween)는 GROMO-851 에서 마지막 호출자가 사라져 삭제됐다
        // — 이제 컴파일러가 회귀를 막으므로 never() 단언이 필요 없다.
        verify(dailyFocusStatRepository, never()).findUserIdsWithFocusOnDate(any(), any());
    }

    @Test
    @DisplayName("오늘 미집중 — 지금 진행 중(라이브) 세션 보유자는 집중 중으로 보고 발송하지 않는다")
    void doesNotSendMissedFocusToUserWithOpenSession() {
        User focusingNow = user(UUID.randomUUID()); // 오늘 완료 집중은 아직 0이지만 라이브 세션 진행 중 → 미발송
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(row(focusingNow, 4_000)));
        given(focusSessionRepository.findUserIdsWithLiveSession(anyCollection(), any()))
                .willReturn(List.of(focusingNow.getId()));

        service.sendMissedFocusToday(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("오늘 미집중 — 라이브 세션 조회에 orphan 컷오프(now-12h) 하한을 넘겨 미청소 고아를 라이브에서 배제한다")
    void passesOrphanCutoffBoundToLiveSessionQuery() {
        User target = user(UUID.randomUUID());
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(row(target, 5_000)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(target));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendMissedFocusToday(NOW);

        // 라이브 판정 하한 = now - ORPHAN_TIMEOUT(12h) — 이 하한이 없으면 스윕 전 미종료 고아까지 라이브로 잡혀 과억제.
        verify(focusSessionRepository)
                .findUserIdsWithLiveSession(anyCollection(), eq(NOW.minus(Duration.ofHours(12))));
    }

    @Test
    @DisplayName("오늘 미집중 — 랭킹 페이지 끝이 0초면(이후 전부 미참여) 커서를 더 전진시키지 않고 중단한다")
    void stopsPagingAfterZeroTotalRows() {
        int pageSize = LeagueReengagementNotificationService.NOTIFICATION_PAGE_SIZE;
        List<LeagueRankingRow> allZero = new ArrayList<>();
        for (int i = 0; i <= pageSize; i++) { // pageSize+1 개 → hasMore=true 지만 전부 0초
            allZero.add(row(user(UUID.randomUUID()), 0));
        }
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(allZero);

        service.sendMissedFocusToday(NOW);

        // 첫 페이지 끝이 0초 → hasMore 여도 커서 기반 2차 조회 없이 종료
        verify(leagueRankingQueryRepository, times(1))
                .findGlobalRankingPage(any(), any(), any(), any(), anyInt());
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    // ── 스트릭 위기 (밤 22:00) ──────────────────────────────────────────────────

    @Test
    @DisplayName("스트릭 위기 — 스트릭 진행 중 & 오늘 10분 미만인 유저에게만 발송하고 스트릭 일수를 표기한다")
    void sendsStreakAtRiskOnlyToUsersBelowThreshold() {
        User atRisk = user(UUID.randomUUID());  // streak 5, 오늘 300초(<600) → 발송
        User safe = user(UUID.randomUUID());    // streak 3, 오늘 700초(>=600) → 미발송
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(userStreakRepository.findActiveStreakHoldersPage(eq(0), eq(YESTERDAY), isNull(), any()))
                .willReturn(List.of(streak(atRisk.getId(), 5), streak(safe.getId(), 3)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection()))
                .willReturn(List.of(atRisk, safe));
        given(dailyFocusStatRepository.findByUserInAndDate(anyCollection(), eq(TODAY)))
                .willReturn(List.of(dailyStat(atRisk, 300), dailyStat(safe, 700)));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendStreakAtRisk(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(1)).sendIfAllowed(eq(atRisk), any(), message.capture(), eq(NOW));
        verify(pushNotificationService, never()).sendIfAllowed(eq(safe), any(), any(), any());
        assertThat(message.getValue().title()).contains("5");
        assertThat(message.getValue().link()).isEqualTo("gromo://focus");
    }

    @Test
    @DisplayName("스트릭 위기 — 진행 중 스트릭이 없으면 발송하지 않는다")
    void skipsStreakAtRiskWhenNoActiveStreaks() {
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(userStreakRepository.findActiveStreakHoldersPage(eq(0), eq(YESTERDAY), isNull(), any()))
                .willReturn(List.of());

        service.sendStreakAtRisk(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(userRepository, never()).findAllByIdInAndIsDeletedFalse(anyCollection());
    }

    @Test
    @DisplayName("스트릭 위기 — 지금 집중 중(라이브 세션)인 유저는 오늘 10분 미달이어도 발송하지 않는다")
    void skipsStreakAtRiskForActivelyFocusingUser() {
        User focusingNow = user(UUID.randomUUID()); // streak 5, 오늘 완료 통계 200초(<600)지만 라이브 세션 진행 중 → 미발송
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(userStreakRepository.findActiveStreakHoldersPage(eq(0), eq(YESTERDAY), isNull(), any()))
                .willReturn(List.of(streak(focusingNow.getId(), 5)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection()))
                .willReturn(List.of(focusingNow));
        given(dailyFocusStatRepository.findByUserInAndDate(anyCollection(), eq(TODAY)))
                .willReturn(List.of(dailyStat(focusingNow, 200)));
        // eq(now-12h) — orphan 컷오프 하한을 정확히 넘겨야 매칭. 하한이 틀리면 스텁 미스 → 발송되어 테스트 실패(바운드 락).
        given(focusSessionRepository.findUserIdsWithLiveSession(
                anyCollection(), eq(NOW.minus(Duration.ofHours(12)))))
                .willReturn(List.of(focusingNow.getId()));

        service.sendStreakAtRisk(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("스트릭 위기 — 첫 페이지가 가득 차면(PAGE_SIZE+1) userId 키셋 커서로 다음 페이지를 이어 조회한다")
    void pagesStreakHoldersByKeyset() {
        int pageSize = LeagueReengagementNotificationService.NOTIFICATION_PAGE_SIZE;
        List<UserStreak> fullFetch = new ArrayList<>();
        for (int i = 0; i <= pageSize; i++) { // pageSize+1 개 → hasMore=true
            fullFetch.add(streak(UUID.randomUUID(), 3));
        }
        UUID lastUserId = fullFetch.get(pageSize - 1).getUserId(); // subList(0,pageSize) 의 마지막 = 다음 커서
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(userStreakRepository.findActiveStreakHoldersPage(eq(0), eq(YESTERDAY), isNull(), any()))
                .willReturn(fullFetch);
        given(userStreakRepository.findActiveStreakHoldersPage(eq(0), eq(YESTERDAY), eq(lastUserId), any()))
                .willReturn(List.of()); // 2차 페이지 비어있음 → 종료
        // userRepository 기본(empty) → 발송 없음, 커서 전진(2회 조회)만 검증

        service.sendStreakAtRisk(NOW);

        verify(userStreakRepository, times(2))
                .findActiveStreakHoldersPage(anyInt(), any(), any(), any());
    }
}

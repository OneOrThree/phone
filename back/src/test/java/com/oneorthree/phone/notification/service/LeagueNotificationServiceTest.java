package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueMemberResult;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 리그 알림 트리거 테스트 (GROMO-528 커밋④) — 고정 Instant 주입(412/519 선례).
 * PushNotificationService 는 mock — 필터 체인은 PushNotificationServiceTest 가 담당.
 */
@ExtendWith(MockitoExtension.class)
class LeagueNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @Mock
    private LeagueArenaRepository leagueArenaRepository;

    @Mock
    private LeagueArenaUserRepository leagueArenaUserRepository;

    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;

    @Mock
    private PushNotificationService pushNotificationService;

    @InjectMocks
    private LeagueNotificationService leagueNotificationService;

    @Captor
    private ArgumentCaptor<PushMessage> messageCaptor;

    // 2026-07-06 은 월요일. 월 09:00 KST 스케줄 발화 시각.
    private static final Instant MON_0900_KST =
            LocalDate.of(2026, 7, 6).atTime(LocalTime.of(9, 0)).atZone(KST).toInstant();
    // 직전 주차 월요일(2026-06-29) 00:00 KST — findEndedByWeekStartAndResultIn 기대 인자.
    private static final Instant PREV_WEEK_START =
            LocalDate.of(2026, 6, 29).atStartOfDay(KST).toInstant();

    private static User user() {
        return User.builder().id(UUID.randomUUID()).deviceToken("fcm-token").build();
    }

    private static LeagueArenaUser member(LeagueMemberResult result, int tierLevel) {
        return LeagueArenaUser.builder()
                .id(UUID.randomUUID())
                .user(user())
                .tierLevel(tierLevel)
                .result(result)
                .build();
    }

    // ── ①② 승격/강등 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("① PROMOTED → 제목 '🎉 우리 승격했어 !' + {상위티어}=tierLevel+1 티어명 + link gromo://league")
    void promotedMemberGetsPromotionMessage() {
        LeagueArenaUser promoted = member(LeagueMemberResult.PROMOTED, 2); // 상위 = 3 초집중 모드
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of(promoted));
        given(userNotificationSettingsRepository.findAllById(anyCollection())).willReturn(List.of());

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        verify(pushNotificationService)
                .sendIfAllowed(eq(promoted.getUser()), any(), messageCaptor.capture(), eq(MON_0900_KST));
        PushMessage message = messageCaptor.getValue();
        assertThat(message.title()).isEqualTo("🎉 우리 승격했어 !");
        assertThat(message.body()).contains("초집중 모드");
        assertThat(message.link()).isEqualTo("gromo://league");
    }

    @Test
    @DisplayName("② RELEGATED → {하위티어}=tierLevel-1 티어명 + link gromo://focus")
    void relegatedMemberGetsRelegationMessage() {
        LeagueArenaUser relegated = member(LeagueMemberResult.RELEGATED, 3); // 하위 = 2 예열 모드
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of(relegated));
        given(userNotificationSettingsRepository.findAllById(anyCollection())).willReturn(List.of());

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        verify(pushNotificationService)
                .sendIfAllowed(eq(relegated.getUser()), any(), messageCaptor.capture(), eq(MON_0900_KST));
        PushMessage message = messageCaptor.getValue();
        assertThat(message.title()).isEqualTo("저번 주 리그가 종료되었어요!");
        assertThat(message.body()).contains("예열 모드");
        assertThat(message.link()).isEqualTo("gromo://focus");
    }

    @Test
    @DisplayName("STAY/RELEGATE_WARNING/null 은 쿼리 result IN [PROMOTED, RELEGATED] 필터로 제외")
    void onlyPromotedAndRelegatedAreQueried() {
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of());

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<LeagueMemberResult>> resultsCaptor =
                ArgumentCaptor.forClass(Collection.class);
        verify(leagueArenaUserRepository)
                .findEndedByWeekStartAndResultIn(any(), resultsCaptor.capture());
        assertThat(resultsCaptor.getValue())
                .containsExactlyInAnyOrder(LeagueMemberResult.PROMOTED, LeagueMemberResult.RELEGATED)
                .doesNotContain(LeagueMemberResult.STAY, LeagueMemberResult.RELEGATE_WARNING);
        // 대상 없음 → 미발송
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("prevWeekStart 산정: 월 09:00 KST now → 7일 전 월요일 00:00 KST 로 조회")
    void resolvesPreviousWeekStart() {
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of());

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        ArgumentCaptor<Instant> weekStartCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(leagueArenaUserRepository)
                .findEndedByWeekStartAndResultIn(weekStartCaptor.capture(), anyCollection());
        assertThat(weekStartCaptor.getValue()).isEqualTo(PREV_WEEK_START);
    }

    @Test
    @DisplayName("티어명 클램프: PROMOTED tierLevel 5 → tierDisplayName(6) 은 최상위 '집중 정복자' 로 클램프")
    void tierNameClampsAboveRange() {
        LeagueArenaUser promoted = member(LeagueMemberResult.PROMOTED, 5); // 상위 = 6 → 클램프 5
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of(promoted));
        given(userNotificationSettingsRepository.findAllById(anyCollection())).willReturn(List.of());

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        verify(pushNotificationService)
                .sendIfAllowed(any(), any(), messageCaptor.capture(), any());
        assertThat(messageCaptor.getValue().body()).contains("집중 정복자");
    }

    @Test
    @DisplayName("주간 결과 - 설정 일괄 로드: findAllById 1회만 (유저별 단건 조회 없음)")
    void weeklyLoadsSettingsInBatch() {
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of(
                        member(LeagueMemberResult.PROMOTED, 2),
                        member(LeagueMemberResult.RELEGATED, 3)));
        given(userNotificationSettingsRepository.findAllById(anyCollection())).willReturn(List.of());

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        verify(userNotificationSettingsRepository, times(1)).findAllById(anyCollection());
        verify(userNotificationSettingsRepository, never()).findById(any());
    }

    @Test
    @DisplayName("settings.soundEnabled=false → PushMessage.soundEnabled()=false 로 전달")
    void promotionRespectsSoundDisabled() {
        LeagueArenaUser promoted = member(LeagueMemberResult.PROMOTED, 2);
        UUID uid = promoted.getUser().getId();
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of(promoted));
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.of(UserNotificationSettings.builder().userId(uid).soundEnabled(false).build()));

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        verify(pushNotificationService)
                .sendIfAllowed(eq(promoted.getUser()), any(), messageCaptor.capture(), eq(MON_0900_KST));
        assertThat(messageCaptor.getValue().soundEnabled()).isFalse();
    }

    @Test
    @DisplayName("여러 멤버 — loadSettings 가 유저별 설정을 정확히 매칭 (soundEnabled 각각)")
    void weeklyMatchesSettingsPerUser() {
        LeagueArenaUser soundOn = member(LeagueMemberResult.PROMOTED, 2);
        LeagueArenaUser soundOff = member(LeagueMemberResult.RELEGATED, 3);
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of(soundOn, soundOff));
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.of(
                        UserNotificationSettings.builder().userId(soundOn.getUser().getId()).soundEnabled(true).build(),
                        UserNotificationSettings.builder().userId(soundOff.getUser().getId()).soundEnabled(false).build()));

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        ArgumentCaptor<PushMessage> onCaptor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService)
                .sendIfAllowed(eq(soundOn.getUser()), any(), onCaptor.capture(), eq(MON_0900_KST));
        assertThat(onCaptor.getValue().soundEnabled()).isTrue();

        ArgumentCaptor<PushMessage> offCaptor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService)
                .sendIfAllowed(eq(soundOff.getUser()), any(), offCaptor.capture(), eq(MON_0900_KST));
        assertThat(offCaptor.getValue().soundEnabled()).isFalse();
    }

    @Test
    @DisplayName("티어명 클램프 하한: RELEGATED tierLevel 1 → tierDisplayName(0) 은 최하위 '뽀시래기' 로 클램프")
    void tierNameClampsBelowRange() {
        LeagueArenaUser relegated = member(LeagueMemberResult.RELEGATED, 1); // 하위 = 0 → 클램프 1
        given(leagueArenaUserRepository.findEndedByWeekStartAndResultIn(any(), anyCollection()))
                .willReturn(List.of(relegated));
        given(userNotificationSettingsRepository.findAllById(anyCollection())).willReturn(List.of());

        leagueNotificationService.sendWeeklyResultNotifications(MON_0900_KST);

        verify(pushNotificationService)
                .sendIfAllowed(any(), any(), messageCaptor.capture(), any());
        assertThat(messageCaptor.getValue().body()).contains("뽀시래기");
    }

    // ── ⑥ 마감 임박 ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("⑥ 아레나 2개(각 N명) → 전원 발송 + {내순위}=findRankedByArena index+1")
    void deadlineSendsToAllWithRank() {
        LeagueArena arena1 = LeagueArena.builder().id(UUID.randomUUID()).build();
        LeagueArena arena2 = LeagueArena.builder().id(UUID.randomUUID()).build();
        LeagueArenaUser a1u1 = member(null, 1);
        LeagueArenaUser a1u2 = member(null, 1);
        LeagueArenaUser a2u1 = member(null, 2);

        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE))
                .willReturn(List.of(arena1, arena2));
        given(leagueArenaUserRepository.findRankedByArena(arena1)).willReturn(List.of(a1u1, a1u2));
        given(leagueArenaUserRepository.findRankedByArena(arena2)).willReturn(List.of(a2u1));
        given(userNotificationSettingsRepository.findAllById(anyCollection())).willReturn(List.of());

        leagueNotificationService.sendDeadlineReminders(MON_0900_KST);

        // 전원(3명) 발송
        verify(pushNotificationService, times(3))
                .sendIfAllowed(any(), any(), messageCaptor.capture(), eq(MON_0900_KST));
        List<PushMessage> messages = messageCaptor.getAllValues();
        // 순위: arena1 [1위, 2위], arena2 [1위]
        assertThat(messages.get(0).body()).contains("1위");
        assertThat(messages.get(1).body()).contains("2위");
        assertThat(messages.get(2).body()).contains("1위");
        assertThat(messages).allSatisfy(m -> {
            assertThat(m.title()).isEqualTo("리그 마감까지 4시간!");
            assertThat(m.link()).isEqualTo("gromo://league");
        });
    }

    @Test
    @DisplayName("⑥ ACTIVE 아레나 없음 → 무발송·정상 종료")
    void deadlineNoActiveArena() {
        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE)).willReturn(List.of());

        leagueNotificationService.sendDeadlineReminders(MON_0900_KST);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(leagueArenaUserRepository, never()).findRankedByArena(any());
    }

    @Test
    @DisplayName("⑥ 설정 일괄 로드: findAllById 1회만")
    void deadlineLoadsSettingsInBatch() {
        LeagueArena arena = LeagueArena.builder().id(UUID.randomUUID()).build();
        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE)).willReturn(List.of(arena));
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(member(null, 1), member(null, 1)));
        given(userNotificationSettingsRepository.findAllById(anyCollection())).willReturn(List.of());

        leagueNotificationService.sendDeadlineReminders(MON_0900_KST);

        verify(userNotificationSettingsRepository, times(1)).findAllById(anyCollection());
        verify(userNotificationSettingsRepository, never()).findById(any());
    }
}

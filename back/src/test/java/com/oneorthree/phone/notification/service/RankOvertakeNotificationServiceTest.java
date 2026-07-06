package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotRepository;
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

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 순위 추월 푸시 트리거 테스트 (GROMO-579) — 고정 Instant 주입(LeagueNotificationService 선례).
 * 추월 감지(어제 아래→오늘 위)·묶음 문구·각 억제조건 스킵·스냅샷 저장·부트스트랩 무발송을 검증한다.
 *
 * <p>기본 픽스처: 아레나 1개, 나(me) + 라이벌1(r1) + 라이벌2(r2) + 꼴찌(bottom) 4명.
 * 오늘 순위 = [r1, r2, me, bottom]. 어제 순위 = [me, bottom, r1, r2] (즉 r1·r2 가 어제 나보다 아래였다가 오늘 나보다 위).
 * → me 는 r1·r2 에게 추월당함, 대표 = r1(오늘 최상위 라이벌). bottom 은 최하위라 억제(a).
 */
@ExtendWith(MockitoExtension.class)
class RankOvertakeNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 2026-07-06(월) 19:00 KST = 2026-07-06T10:00:00Z. today(KST)=2026-07-06(월), yesterday=2026-07-05(일).
    // 월요일이라 다음 마감(월 00:00)까지 약 5일 → 마감 임박(12h) 아님(억제 d 미발동).
    private static final Instant NOW = Instant.parse("2026-07-06T10:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 6);
    private static final LocalDate YESTERDAY = LocalDate.of(2026, 7, 5);
    // 어제 대비 오늘 이미 접속 판정 기준(오늘 0시 KST)보다 이전 = 미접속
    private static final Instant BEFORE_TODAY = Instant.parse("2026-07-04T00:00:00Z");

    private final UUID arenaId = UUID.randomUUID();
    private final UUID meId = UUID.randomUUID();
    private final UUID r1Id = UUID.randomUUID();
    private final UUID r2Id = UUID.randomUUID();
    private final UUID bottomId = UUID.randomUUID();

    @Mock
    private LeagueArenaRepository leagueArenaRepository;
    @Mock
    private LeagueArenaUserRepository leagueArenaUserRepository;
    @Mock
    private LeagueRankSnapshotRepository leagueRankSnapshotRepository;
    @Mock
    private FocusSessionRepository focusSessionRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private RankOvertakeNotificationService service;

    private LeagueArena arena;

    @BeforeEach
    void setUp() {
        arena = LeagueArena.builder().id(arenaId).status(LeagueArenaStatus.ACTIVE).build();
    }

    private static User user(UUID id, String nickname, Instant lastActiveAt) {
        return User.builder().id(id).nickname(nickname).deviceToken("token-" + id)
                .lastActiveAt(lastActiveAt).build();
    }

    private LeagueArenaUser member(User u) {
        return LeagueArenaUser.builder().leagueArena(arena).user(u).tierLevel(1).build();
    }

    private LeagueRankSnapshot snapshot(UUID userId, int rank, LocalDate day) {
        return LeagueRankSnapshot.builder().arenaId(arenaId).userId(userId).rank(rank).capturedOn(day).build();
    }

    // 기본 픽스처 stub — 오늘 [r1,r2,me,bottom], 어제 [me,bottom,r1,r2].
    // 억제 데이터는 모두 "통과"로 세팅(미접속·미집중·쿨다운 없음·주간 0회). 필요한 테스트만 override.
    private User setUpDefaultScenario() {
        User me = user(meId, "나", BEFORE_TODAY);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        User r2 = user(r2Id, "라이벌투", BEFORE_TODAY);
        User bottom = user(bottomId, "꼴찌", BEFORE_TODAY);

        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE)).willReturn(List.of(arena));
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(member(r1), member(r2), member(me), member(bottom)));
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), YESTERDAY))
                .willReturn(List.of(
                        snapshot(meId, 1, YESTERDAY), snapshot(bottomId, 2, YESTERDAY),
                        snapshot(r1Id, 3, YESTERDAY), snapshot(r2Id, 4, YESTERDAY)));
        // 오늘 스냅샷은 아직 없음(신규 INSERT 경로)
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), TODAY))
                .willReturn(List.of());
        // 억제 통과 기본값 — 오늘 집중 없음, 이번 주 발송 로그 없음
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyList(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());
        lenient().when(userNotificationSettingsRepository.findAllById(any()))
                .thenReturn(List.of(UserNotificationSettings.builder()
                        .userId(meId).notificationEnabled(true).soundEnabled(true).build()));
        lenient().when(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).thenReturn(true);
        return me;
    }

    @Test
    @DisplayName("어제 나보다 아래였던 라이벌이 오늘 나보다 위면 추월로 감지해 발송한다")
    void detectsOvertakeAndSends() {
        User me = setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        // 나에게만 발송(bottom 은 최하위 억제, r1·r2 는 추월당하지 않음)
        verify(pushNotificationService, times(1)).sendIfAllowed(any(), any(), any(), eq(NOW));
        verify(pushNotificationService).sendIfAllowed(eq(me), any(), any(), eq(NOW));
    }

    @Test
    @DisplayName("라이벌 2명이면 대표 1명 + '외 1명' 묶음 문구로 조립한다 (제목/본문/딥링크 정확)")
    void bundlesMultipleRivalsIntoOneMessage() {
        setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(any(), any(), captor.capture(), eq(NOW));
        PushMessage sent = captor.getValue();
        // 대표 = r1(오늘 최상위 라이벌), 총 2명 → "외 1명"
        assertThat(sent.title()).isEqualTo("라이벌원님 외 1명한테 순위 뺏겼어요!");
        assertThat(sent.body()).isEqualTo("잠깐 집중해서 다시 제쳐볼까요?");
        assertThat(sent.link()).isEqualTo("gromo://league");
    }

    @Test
    @DisplayName("라이벌 1명이면 '외 N명' 없는 단수 문구로 조립한다")
    void singleRivalMessage() {
        User me = user(meId, "나", BEFORE_TODAY);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        User bottom = user(bottomId, "꼴찌", BEFORE_TODAY);
        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE)).willReturn(List.of(arena));
        // 오늘 [r1, me, bottom], 어제 [me, bottom, r1] → r1 한 명만 추월(me 는 bottom 이 있어 최하위 아님)
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(member(r1), member(me), member(bottom)));
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), YESTERDAY))
                .willReturn(List.of(snapshot(meId, 1, YESTERDAY),
                        snapshot(bottomId, 2, YESTERDAY), snapshot(r1Id, 3, YESTERDAY)));
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), TODAY))
                .willReturn(List.of());
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyList(), any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of());
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        service.sendRankOvertakeNotifications(NOW);

        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        // me 에게만 발송(bottom 은 최하위 억제) — 단수 문구
        verify(pushNotificationService, times(1)).sendIfAllowed(any(), any(), any(), eq(NOW));
        verify(pushNotificationService).sendIfAllowed(eq(me), any(), captor.capture(), eq(NOW));
        assertThat(captor.getValue().title()).isEqualTo("라이벌원님한테 순위 뺏겼어요!");
    }

    @Test
    @DisplayName("억제(a) 최하위 유저(아래에 아무도 없음)는 추월당해도 발송하지 않는다")
    void suppressesWhenLastPlace() {
        // 오늘 [r1, me] — me 가 최하위. 어제 [me, r1] 로 r1 이 me 를 추월했어도 me 는 최하위라 스킵.
        User me = user(meId, "나", BEFORE_TODAY);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE)).willReturn(List.of(arena));
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(member(r1), member(me)));
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), YESTERDAY))
                .willReturn(List.of(snapshot(meId, 1, YESTERDAY), snapshot(r1Id, 2, YESTERDAY)));
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), TODAY))
                .willReturn(List.of());
        lenient().when(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyList(), any(), any()))
                .thenReturn(List.of());
        lenient().when(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .thenReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("억제(b) 오늘 이미 접속(lastActiveAt >= 오늘0시 KST)한 유저는 스킵한다")
    void suppressesWhenActiveToday() {
        setUpDefaultScenario();
        // me 의 lastActiveAt 을 오늘 접속으로 override — 오늘 [r1,r2,me,bottom] 에서 me 만 재설정
        User meActive = user(meId, "나", NOW);   // NOW = 오늘 19:00 KST → 오늘 0시 이후
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        User r2 = user(r2Id, "라이벌투", BEFORE_TODAY);
        User bottom = user(bottomId, "꼴찌", BEFORE_TODAY);
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(member(r1), member(r2), member(meActive), member(bottom)));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("억제(c) 오늘 이미 집중한 유저는 스킵한다")
    void suppressesWhenFocusedToday() {
        setUpDefaultScenario();
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyList(), any(), any()))
                .willReturn(List.of(meId));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("억제(d) 다음 리그 마감까지 12h 이내면 전원 스킵한다")
    void suppressesWhenDeadlineImminent() {
        // 일요일 19:00 KST = 2026-07-05T10:00Z. 다음 마감(월 00:00 KST) = 2026-07-06T00:00 KST → 약 5h 남음(12h 이내).
        Instant sundayEvening = Instant.parse("2026-07-05T10:00:00Z");   // 일 19:00 KST
        LocalDate sun = LocalDate.of(2026, 7, 5);
        LocalDate sat = LocalDate.of(2026, 7, 4);
        User me = user(meId, "나", BEFORE_TODAY);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE)).willReturn(List.of(arena));
        // 오늘 [r1, me], 어제 [me, r1] → r1 이 me 를 추월했으나 마감 임박이라 스킵
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(member(r1), member(me)));
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), sat))
                .willReturn(List.of(snapshot(meId, 1, sat), snapshot(r1Id, 2, sat)));
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), sun))
                .willReturn(List.of());
        lenient().when(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyList(), any(), any()))
                .thenReturn(List.of());
        lenient().when(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .thenReturn(List.of());

        service.sendRankOvertakeNotifications(sundayEvening);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("억제(e) 같은 대표 라이벌에게 48h 이내 이미 발송했으면 스킵한다")
    void suppressesWithinRivalCooldown() {
        setUpDefaultScenario();
        // 대표 라이벌 = r1. (me, r1) 로 24h 전 발송 로그 → 48h 쿨다운 이내라 스킵
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of(NotificationSentLog.builder()
                        .userId(meId).type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                        .targetUserId(r1Id).sentAt(NOW.minusSeconds(24 * 3600)).build()));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("억제(f) 이번 주 이미 2회 발송했으면 주2회 상한으로 스킵한다")
    void suppressesWhenWeeklyCapReached() {
        setUpDefaultScenario();
        // 이번 주(월 00:00 KST 이후) me 에게 2건 — 대표 라이벌과 다른 유저 대상이라 쿨다운(e)엔 안 걸리되 상한(f)만 발동
        Instant weekStart = TODAY.atStartOfDay(KST).toInstant();   // 2026-07-06 월 00:00 KST
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .willReturn(List.of(
                        NotificationSentLog.builder().userId(meId).type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                                .targetUserId(UUID.randomUUID()).sentAt(weekStart.plusSeconds(3600)).build(),
                        NotificationSentLog.builder().userId(meId).type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                                .targetUserId(UUID.randomUUID()).sentAt(weekStart.plusSeconds(7200)).build()));

        service.sendRankOvertakeNotifications(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("실발송(true)된 건만 notification_sent_logs 에 대표 라이벌·now 로 기록한다")
    void logsOnlyActuallySent() {
        setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<NotificationSentLog>> captor = ArgumentCaptor.forClass(List.class);
        verify(notificationSentLogRepository).saveAll(captor.capture());
        List<NotificationSentLog> saved = captor.getValue();
        assertThat(saved).hasSize(1);
        NotificationSentLog logEntry = saved.get(0);
        assertThat(logEntry.getUserId()).isEqualTo(meId);
        assertThat(logEntry.getType()).isEqualTo(NotificationSentLog.TYPE_RANK_OVERTAKE);
        assertThat(logEntry.getTargetUserId()).isEqualTo(r1Id);   // 대표 라이벌
        assertThat(logEntry.getSentAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("quiet hours 등으로 실발송이 false 면 sent_log 를 남기지 않는다")
    void skipsLogWhenNotSent() {
        setUpDefaultScenario();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(false);

        service.sendRankOvertakeNotifications(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<NotificationSentLog>> captor = ArgumentCaptor.forClass(List.class);
        verify(notificationSentLogRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).isEmpty();
    }

    @Test
    @DisplayName("처리 후 오늘 순위를 captured_on=오늘 로 저장한다(다음날 비교 기준)")
    void savesTodaySnapshots() {
        setUpDefaultScenario();

        service.sendRankOvertakeNotifications(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LeagueRankSnapshot>> captor = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotRepository).saveAll(captor.capture());
        List<LeagueRankSnapshot> snapshots = captor.getValue();
        // 아레나 4명 전원 오늘 순위 저장 — 순위 1..4, captured_on=오늘
        assertThat(snapshots).hasSize(4);
        assertThat(snapshots).allSatisfy(s -> {
            assertThat(s.getCapturedOn()).isEqualTo(TODAY);
            assertThat(s.getArenaId()).isEqualTo(arenaId);
        });
        assertThat(snapshots).extracting(LeagueRankSnapshot::getUserId, LeagueRankSnapshot::getRank)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(r1Id, 1),
                        org.assertj.core.groups.Tuple.tuple(r2Id, 2),
                        org.assertj.core.groups.Tuple.tuple(meId, 3),
                        org.assertj.core.groups.Tuple.tuple(bottomId, 4));
    }

    @Test
    @DisplayName("부트스트랩: 어제 스냅샷이 없으면 감지·발송 없이 오늘 스냅샷만 저장한다")
    void bootstrapSavesSnapshotWithoutSending() {
        User me = user(meId, "나", BEFORE_TODAY);
        User r1 = user(r1Id, "라이벌원", BEFORE_TODAY);
        given(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE)).willReturn(List.of(arena));
        given(leagueArenaUserRepository.findRankedByArena(arena))
                .willReturn(List.of(member(r1), member(me)));
        // 어제 스냅샷 없음(첫 실행) — 감지 불가
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), YESTERDAY))
                .willReturn(List.of());
        given(leagueRankSnapshotRepository.findByArenaIdInAndCapturedOn(List.of(arenaId), TODAY))
                .willReturn(List.of());
        lenient().when(focusSessionRepository.findUserIdsWithSessionStartedBetween(anyList(), any(), any()))
                .thenReturn(List.of());
        lenient().when(notificationSentLogRepository.findByTypeAndUserIdInSince(any(), anyList(), any()))
                .thenReturn(List.of());

        service.sendRankOvertakeNotifications(NOW);

        // 무발송
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        // 오늘 스냅샷은 저장
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LeagueRankSnapshot>> captor = ArgumentCaptor.forClass(List.class);
        verify(leagueRankSnapshotRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).hasSize(2);
    }
}

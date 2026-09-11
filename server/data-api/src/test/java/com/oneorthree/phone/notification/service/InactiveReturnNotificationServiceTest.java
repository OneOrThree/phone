package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 미접속 복귀 푸시 트리거 테스트 (GROMO-578) — 고정 Instant 주입(LeagueNotificationService 선례).
 * KST date diff 경계 계산과 단계별 문구·딥링크가 apns.md §3-④ 와 정확히 일치하는지 검증.
 */
@ExtendWith(MockitoExtension.class)
class InactiveReturnNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 2026-07-06 10:00 KST (배치 고정 시각) — today(KST) = 2026-07-06
    private static final Instant NOW = Instant.parse("2026-07-06T01:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 6);

    private static final PushMessage MSG_D3 = new PushMessage(
            "요즘 안 보이네", "방이 좀 허전해. 잠깐 들러서 얼굴만 보여줄래?", "gromo://home", true);
    private static final PushMessage MSG_D7 = new PushMessage(
            "벌써 일주일째야", "네가 모은 코인이랑 방, 그대로 기다리고 있어. 5분만 같이 집중할까?", "gromo://home", true);
    private static final PushMessage MSG_D14 = new PushMessage(
            "처음 그 마음, 기억나?",
            "네가 직접 정한 목표가 아직 그대로 남아있어. 초심으로 딱 한 번만 다시 시작해보자.", "gromo://home", true);

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private PushNotificationService pushNotificationService;

    private InactiveReturnNotificationService service;

    /**
     * 서비스는 테스트마다 새로 조립한다 — {@code @InjectMocks} 로는 아래 {@code legacyDispatcher}
     * 처럼 «목이 아닌 실물»을 끼워 넣을 수 없다.
     */
    @BeforeEach
    void assembleService() {
        service = new InactiveReturnNotificationService(
                userRepository,
                userQueryService,
                pushNotificationService,
                legacyDispatcher(pushNotificationService));
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

    private static Instant startOfDayKst(LocalDate date) {
        return date.atStartOfDay(KST).toInstant();
    }

    // 정확히 N일째 = last_active_at KST 날짜가 (오늘 − N일)인 유저 → [오늘−N, 오늘−N+1) 반열림 구간
    private Instant stageStart(int days) {
        return startOfDayKst(TODAY.minusDays(days));
    }

    private Instant stageEnd(int days) {
        return startOfDayKst(TODAY.minusDays(days - 1L));
    }

    private static User user(UUID id) {
        return User.builder().id(id).isGuest(false).deviceToken("token-" + id).build();
    }

    private static UserNotificationSettings soundOnSettings(UUID id) {
        return UserNotificationSettings.builder().userId(id).notificationEnabled(true).soundEnabled(true).build();
    }

    @Test
    @DisplayName("D+3/7/14 경계 유저 각각에게 단계별 문구·딥링크로 sendIfAllowed 를 호출한다")
    void sendsStageSpecificMessageForEachBoundary() {
        UUID id3 = UUID.randomUUID();
        UUID id7 = UUID.randomUUID();
        UUID id14 = UUID.randomUUID();
        User u3 = user(id3);
        User u7 = user(id7);
        User u14 = user(id14);

        given(userRepository.findInactiveReturnTargets(stageStart(3), stageEnd(3))).willReturn(List.of(u3));
        given(userRepository.findInactiveReturnTargets(stageStart(7), stageEnd(7))).willReturn(List.of(u7));
        given(userRepository.findInactiveReturnTargets(stageStart(14), stageEnd(14))).willReturn(List.of(u14));
        given(userQueryService.findAllNotificationSettings(any()))
                .willReturn(List.of(soundOnSettings(id3), soundOnSettings(id7), soundOnSettings(id14)));

        service.sendInactiveReturnNotifications(NOW);

        verify(pushNotificationService).sendIfAllowed(eq(u3), any(), eq(MSG_D3), eq(NOW));
        verify(pushNotificationService).sendIfAllowed(eq(u7), any(), eq(MSG_D7), eq(NOW));
        verify(pushNotificationService).sendIfAllowed(eq(u14), any(), eq(MSG_D14), eq(NOW));
        // 설정은 findAllById 로 1회만 일괄 로드 (유저별 단건 조회 N+1 금지)
        verify(userQueryService, times(1)).findAllNotificationSettings(any());
    }

    @Test
    @DisplayName("D+3 문구·본문·딥링크(gromo://home)가 정확하다")
    void d3MessageAndLinkAreExact() {
        UUID id3 = UUID.randomUUID();
        User u3 = user(id3);
        given(userRepository.findInactiveReturnTargets(stageStart(3), stageEnd(3))).willReturn(List.of(u3));
        given(userRepository.findInactiveReturnTargets(stageStart(7), stageEnd(7))).willReturn(List.of());
        given(userRepository.findInactiveReturnTargets(stageStart(14), stageEnd(14))).willReturn(List.of());
        given(userQueryService.findAllNotificationSettings(any())).willReturn(List.of(soundOnSettings(id3)));

        service.sendInactiveReturnNotifications(NOW);

        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(eq(u3), any(), captor.capture(), eq(NOW));
        PushMessage sent = captor.getValue();
        assertThat(sent.title()).isEqualTo("요즘 안 보이네");
        assertThat(sent.body()).isEqualTo("방이 좀 허전해. 잠깐 들러서 얼굴만 보여줄래?");
        assertThat(sent.link()).isEqualTo("gromo://home");
    }

    @Test
    @DisplayName("조회 구간은 정확히 D+3/7/14 경계 3개뿐 — 2·4·8·15일차 등 비대상은 조회·발송하지 않는다")
    void queriesExactlyThreeEscalationWindows() {
        given(userRepository.findInactiveReturnTargets(any(), any())).willReturn(List.of());

        service.sendInactiveReturnNotifications(NOW);

        ArgumentCaptor<Instant> startCaptor = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> endCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(userRepository, times(3)).findInactiveReturnTargets(startCaptor.capture(), endCaptor.capture());

        // 조회된 하한들이 정확히 오늘−3/−7/−14 KST 자정뿐 → 2·4·8·15일차 경계는 애초에 질의되지 않음
        assertThat(startCaptor.getAllValues())
                .containsExactlyInAnyOrder(stageStart(3), stageStart(7), stageStart(14));
        assertThat(endCaptor.getAllValues())
                .containsExactlyInAnyOrder(stageEnd(3), stageEnd(7), stageEnd(14));
        // 대상 없음 → 발송·설정 로드 모두 없음
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(userQueryService, never()).findAllNotificationSettings(any());
    }

    @Test
    @DisplayName("D+3/7/14 조회 창은 서로 겹치지 않는다 — 동일 유저가 두 단계에 동시에 걸릴 수 없다(mutual exclusivity)")
    void escalationWindowsAreMutuallyExclusive() {
        given(userRepository.findInactiveReturnTargets(any(), any())).willReturn(List.of());

        service.sendInactiveReturnNotifications(NOW);

        ArgumentCaptor<Instant> startCaptor = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> endCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(userRepository, times(3)).findInactiveReturnTargets(startCaptor.capture(), endCaptor.capture());

        List<Instant> starts = startCaptor.getAllValues();
        List<Instant> ends = endCaptor.getAllValues();
        // 세 창 [start, end) 를 하한 오름차순으로 정렬 후 인접 창이 겹치지 않는지 검증.
        // 반열림 구간이 disjoint → 어떤 last_active_at 값도 최대 한 창에만 속함(유저당 단일 단계 매치 보장).
        List<Integer> order = List.of(0, 1, 2).stream()
                .sorted(java.util.Comparator.comparing(starts::get))
                .toList();
        for (int i = 0; i + 1 < order.size(); i++) {
            Instant prevEnd = ends.get(order.get(i));
            Instant nextStart = starts.get(order.get(i + 1));
            // 앞 창의 상한(end, 배타) <= 뒤 창의 하한(start, 포함) → 겹침 없음
            assertThat(prevEnd).isBeforeOrEqualTo(nextStart);
        }
    }

    @Test
    @DisplayName("last_active_at 가 정확히 D+3 경계인 유저는 D+3 창에만 매치되고 D+7/14 창에는 잡히지 않는다")
    void exactD3BoundaryUserMatchesOnlyD3Window() {
        UUID id3 = UUID.randomUUID();
        User u3 = user(id3);
        // last_active_at = 오늘−3일 KST 자정 정각(D+3 창의 포함 하한). D+3 창에만 걸리도록 stub 하고
        // D+7/14 창은 비운다 → 발송이 정확히 D+3 문구 1건인지로 상호배타를 검증.
        given(userRepository.findInactiveReturnTargets(stageStart(3), stageEnd(3))).willReturn(List.of(u3));
        given(userRepository.findInactiveReturnTargets(stageStart(7), stageEnd(7))).willReturn(List.of());
        given(userRepository.findInactiveReturnTargets(stageStart(14), stageEnd(14))).willReturn(List.of());
        given(userQueryService.findAllNotificationSettings(any())).willReturn(List.of(soundOnSettings(id3)));

        service.sendInactiveReturnNotifications(NOW);

        // 정확히 D+3 1건만 — D+7/14 문구로는 발송되지 않음
        verify(pushNotificationService, times(1)).sendIfAllowed(any(), any(), any(), any());
        verify(pushNotificationService).sendIfAllowed(eq(u3), any(), eq(MSG_D3), eq(NOW));
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), eq(MSG_D7), any());
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), eq(MSG_D14), any());
    }

    @Test
    @DisplayName("소리 설정이 꺼진 유저는 문구의 soundEnabled 도 false 로 조립된다")
    void soundDisabledPropagatesToMessage() {
        UUID id3 = UUID.randomUUID();
        User u3 = user(id3);
        UserNotificationSettings soundOff = UserNotificationSettings.builder()
                .userId(id3).notificationEnabled(true).soundEnabled(false).build();
        given(userRepository.findInactiveReturnTargets(stageStart(3), stageEnd(3))).willReturn(List.of(u3));
        given(userRepository.findInactiveReturnTargets(stageStart(7), stageEnd(7))).willReturn(List.of());
        given(userRepository.findInactiveReturnTargets(stageStart(14), stageEnd(14))).willReturn(List.of());
        given(userQueryService.findAllNotificationSettings(any())).willReturn(List.of(soundOff));

        service.sendInactiveReturnNotifications(NOW);

        PushMessage expected = new PushMessage(
                "요즘 안 보이네", "방이 좀 허전해. 잠깐 들러서 얼굴만 보여줄래?", "gromo://home", false);
        verify(pushNotificationService).sendIfAllowed(eq(u3), eq(soundOff), eq(expected), eq(NOW));
    }
}

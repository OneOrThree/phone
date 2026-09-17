package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.IdempotentOutcome;
import com.oneorthree.phone.outbox.dto.PublicCommandReceipt;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * GROMO-1764 후속 — 수명주기 경로의 <b>가드 셋</b>을 못박는다. 전부 DB 제약이나 배포 사고로만
 * 드러나는 결함이라 Testcontainers 없이 mock 으로 「순서」와 「anchor」를 직접 본다.
 *
 * <ol>
 *   <li><b>시작 게이트</b> — finish 가 항상 503 인 동안 start 가 세션을 만들면 사용자가 끝낼 수 없는
 *       세션에 갇힌다(v0.3 상세는 12h orphan 스윕에서도 빠진다)</li>
 *   <li><b>구간 전환 순서</b> — 닫는 UPDATE 를 flush 하지 않고 새 구간을 save 하면 Hibernate 가
 *       INSERT 를 먼저 내보내 {@code focus_session_intervals_open_uk} 를 위반한다</li>
 *   <li><b>전이 시각 역행</b> — NTP 보정으로 벽시계가 뒤로 가면 {@code ended_at >= started_at} CHECK 가
 *       깨져 정상 pause 가 500 이 된다</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FocusSessionLifecycleGuardsTest {

    private static final Instant NOW = Instant.parse("2026-09-17T03:00:00Z");
    private static final Instant STARTED_AT = Instant.parse("2026-09-17T02:00:00Z");
    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID KEY = UUID.fromString("dddddddd-0000-0000-0000-000000000001");

    @Mock private UserQueryService userQueryService;
    @Mock private GroupQueryService groupQueryService;
    @Mock private UserIslandContextLockService userIslandContextLockService;
    @Mock private FocusSessionRepository focusSessionRepository;
    @Mock private FocusSessionDetailRepository focusSessionDetailRepository;
    @Mock private FocusSessionIntervalRepository focusSessionIntervalRepository;
    @Mock private DailyFocusStatRepository dailyFocusStatRepository;
    @Mock private PublicCommandService publicCommands;
    @Mock private OutboxCommandPort outboxCommandPort;

    private FocusSessionLifecycleService service(Instant wallClock) {
        return new FocusSessionLifecycleService(userQueryService, groupQueryService,
                userIslandContextLockService, focusSessionRepository, focusSessionDetailRepository,
                focusSessionIntervalRepository, dailyFocusStatRepository, publicCommands, outboxCommandPort,
                Clock.fixed(wallClock, ZoneOffset.UTC));
    }

    // ── 1. 시작 게이트 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("start 는 게이트가 닫혀 있는 한 503 이다 — 끝낼 수 없는 세션을 만들지 않는다")
    void startIsRefusedWhileTheGateIsClosed() {
        assertThatThrownBy(() -> service(NOW).start(USER,
                new FocusSessionStartCommandRequest(ISLAND, "알고리즘", 60), KEY))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_START_UNAVAILABLE);

        // 게이트는 «가장 앞»이다 — 잠금도, 멱등 명령도, 어떤 행도 만들지 않는다.
        verify(userQueryService, never()).getCallerForUpdate(any());
        verify(publicCommands, never()).run(any(), any(), any(), any());
        verify(focusSessionRepository, never()).save(any());
        verify(focusSessionDetailRepository, never()).save(any());
    }

    @Test
    @DisplayName("입력이 잘못돼 있어도 게이트가 먼저다 — 400 이 아니라 503 을 준다")
    void startGateWinsOverInputValidation() {
        assertThatThrownBy(() -> service(NOW).start(USER, null, KEY))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_START_UNAVAILABLE);
    }

    // ── 2. 구간 전환 순서(flush) ──────────────────────────────────────────────

    @Test
    @DisplayName("pause 는 닫는 UPDATE 를 flush 한 «뒤» 새 REST 구간을 저장한다")
    void pauseFlushesTheClosingUpdateBeforeInsertingTheNextInterval() {
        FocusSessionDetail detail = givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);

        FocusSessionView view = service(NOW).pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY);

        InOrder order = inOrder(focusSessionIntervalRepository);
        order.verify(focusSessionIntervalRepository).flush();
        order.verify(focusSessionIntervalRepository).save(any(FocusSessionInterval.class));
        assertThat(view.status()).isEqualTo(FocusSessionView.STATUS_PAUSED);
        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.PAUSED);
    }

    @Test
    @DisplayName("resume 도 같다 — flush 없이 save 하면 열린 구간이 둘이 되어 부분 UNIQUE 를 위반한다")
    void resumeFlushesTheClosingUpdateBeforeInsertingTheNextInterval() {
        FocusSessionDetail detail = givenTransition(FocusSessionLifecycle.PAUSED, FocusIntervalKind.REST);

        FocusSessionView view = service(NOW).resume(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY);

        InOrder order = inOrder(focusSessionIntervalRepository);
        order.verify(focusSessionIntervalRepository).flush();
        order.verify(focusSessionIntervalRepository).save(any(FocusSessionInterval.class));
        assertThat(view.status()).isEqualTo(FocusSessionView.STATUS_ACTIVE);
        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.ACTIVE);
    }

    // ── 3. 전이 시각 역행 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("벽시계가 뒤로 가도 전이 시각은 직전 전이보다 이르지 않다 — ended_at >= started_at 을 지킨다")
    void transitionNeverMovesBackwardsWhenTheWallClockDoes() {
        // NTP 보정으로 시계가 열린 구간 시작보다 30분 «이전»으로 물러난 상황.
        Instant rewound = STARTED_AT.minusSeconds(1800);
        FocusSessionDetail detail = givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);

        service(rewound).pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY);

        assertThat(openInterval().getEndedAt())
                .as("닫는 시각은 구간 시작(=직전 전이)보다 이르면 안 된다")
                .isEqualTo(STARTED_AT);
        assertThat(detail.getLastTransitionAt()).isEqualTo(STARTED_AT);
        assertThat(savedInterval().getStartedAt())
                .as("새로 여는 구간도 같은 anchor 에서 시작한다")
                .isEqualTo(STARTED_AT);
    }

    @Test
    @DisplayName("시계가 정상이면 전이 시각은 그대로 지금이다 — 앵커가 시간을 붙잡아 두지 않는다")
    void transitionUsesTheWallClockWhenItHasNotMovedBackwards() {
        givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);

        service(NOW).pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY);

        assertThat(openInterval().getEndedAt()).isEqualTo(NOW);
        assertThat(savedInterval().getStartedAt()).isEqualTo(NOW);
    }

    // ── 4. summary 의 desync 감지 ─────────────────────────────────────────────

    @Test
    @DisplayName("summary 도 기본 마커가 닫힌 세션을 세지 않는다 — 안 그러면 합계가 계속 부푼다")
    void summaryDropsTheSessionWhoseMarkerWasClosedOutside() {
        FocusSessionDetail detail = detail(FocusSessionLifecycle.ACTIVE);
        when(focusSessionDetailRepository.findFirstByUserIdAndLifecycleIn(eq(USER), any()))
                .thenReturn(Optional.of(detail));
        // 레거시 start 가 닫아 둔 마커.
        when(focusSessionRepository.findById(SESSION))
                .thenReturn(Optional.of(marker(Instant.parse("2026-09-17T02:30:00Z"))));
        when(dailyFocusStatRepository.findByUserAndDate(any(), any())).thenReturn(Optional.empty());

        var summary = service(NOW).summary(USER, "2026-09-17", "Asia/Seoul");

        assertThat(summary.currentSessionSecondsToday()).isZero();
        assertThat(summary.totalSeconds()).isZero();
        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.ABANDONED);
        verify(focusSessionIntervalRepository, never()).findBySessionIdOrderByOrdinalAsc(any());
    }

    // ─────────────────────────────────────────────────────────────────────────

    /** pause/resume 이 실제로 명령 본문까지 들어가도록 잠금·멱등·이벤트 배선을 세운다. */
    private FocusSessionDetail givenTransition(FocusSessionLifecycle lifecycle, FocusIntervalKind openKind) {
        FocusSessionDetail detail = detail(lifecycle);
        when(focusSessionDetailRepository.findBySessionIdForUpdate(SESSION)).thenReturn(Optional.of(detail));
        when(focusSessionRepository.findById(SESSION)).thenReturn(Optional.of(marker(null)));
        when(focusSessionIntervalRepository.findBySessionIdOrderByOrdinalAsc(SESSION))
                .thenReturn(List.of(FocusSessionInterval.builder()
                        .sessionId(SESSION).ordinal(1).kind(openKind).startedAt(STARTED_AT).build()));
        when(focusSessionDetailRepository.findUsedRestSeatsByIslandId(ISLAND)).thenReturn(List.of());
        when(focusSessionIntervalRepository.save(any(FocusSessionInterval.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(outboxCommandPort.append(any())).thenAnswer(invocation -> envelope());
        when(publicCommands.run(any(), any(), any(), any())).thenAnswer(invocation -> {
            PublicCommandRequest request = invocation.getArgument(0);
            Supplier<PublicCommandResult> command = invocation.getArgument(3);
            return new IdempotentOutcome<>(PublicCommandReceipt.completed(request, command.get()), false);
        });
        return detail;
    }

    /** 스텁이 돌려준 열린 구간 — 서비스가 그 자리에서 {@code close(anchor)} 한 엔티티다. */
    private FocusSessionInterval openInterval() {
        return focusSessionIntervalRepository.findBySessionIdOrderByOrdinalAsc(SESSION).get(0);
    }

    private FocusSessionInterval savedInterval() {
        var captor = org.mockito.ArgumentCaptor.forClass(FocusSessionInterval.class);
        verify(focusSessionIntervalRepository).save(captor.capture());
        return captor.getValue();
    }

    private static FocusSessionDetail detail(FocusSessionLifecycle lifecycle) {
        return FocusSessionDetail.builder()
                .sessionId(SESSION)
                .userId(USER)
                .islandId(ISLAND)
                .membershipEpochAtStart(1L)
                .subject("알고리즘")
                .targetMinutes(60)
                .lifecycle(lifecycle)
                .version(1L)
                .lastTransitionAt(STARTED_AT)
                .build();
    }

    private static FocusSession marker(Instant endedAt) {
        return FocusSession.builder().startedAt(STARTED_AT).endedAt(endedAt).build();
    }

    private static EventEnvelope envelope() {
        return new EventEnvelope(UUID.randomUUID().toString(), 1, "focus.member.updated", NOW, null,
                USER, null, USER.toString(), 1L, Map.of());
    }
}

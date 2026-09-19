package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.currency.service.FishWalletService;
import com.oneorthree.phone.focus.repository.FocusRewardPolicyRepository;
import com.oneorthree.phone.focus.repository.FocusSettlementRepository;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionOwnership;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusSessionStartGate;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.IdempotentOutcome;
import com.oneorthree.phone.outbox.dto.PublicCommandReceipt;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.focus.service.FocusMemberEvents;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * GROMO-1764 후속 — 수명주기 경로의 <b>가드 셋</b>을 못박는다. 전부 DB 제약이나 배포 사고로만
 * 드러나는 결함이라 Testcontainers 없이 mock 으로 「순서」와 「anchor」를 직접 본다.
 *
 * <ol>
 *   <li><b>시작 게이트</b> — 배포 설정({@code focus.session.start-enabled})이 꺼져 있으면 어떤 행도 만들지
 *       않는다(GROMO-1924 에서 상수 false → 설정)</li>
 *   <li><b>구간 전환 순서</b> — 닫는 UPDATE 를 flush 하지 않고 새 구간을 save 하면 Hibernate 가
 *       INSERT 를 먼저 내보내 {@code focus_session_intervals_open_uk} 를 위반한다</li>
 *   <li><b>전이 시각 역행</b> — NTP 보정으로 벽시계가 뒤로 가면 {@code ended_at >= started_at} CHECK 가
 *       깨져 정상 pause 가 500 이 된다</li>
 *   <li><b>섬 소속 상실</b> — 탈퇴·강퇴된 사용자가 pause/resume 으로 섬 화면에 계속 뜨는 것을 막는다</li>
 *   <li><b>조회 스냅샷</b> — {@code current}·{@code summary} 가 상세와 구간을 서로 다른 스냅샷에서 읽으면
 *       「active 인데 열린 REST 구간」 같은 불가능한 응답이 나간다</li>
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
    @Mock private GroupMembershipMutationLocks membershipLocks;
    @Mock private GroupMemberRepository groupMemberRepository;
    @Mock private UserIslandContextLockService userIslandContextLockService;
    @Mock private FocusSessionRepository focusSessionRepository;
    @Mock private FocusSessionDetailRepository focusSessionDetailRepository;
    @Mock private FocusSessionIntervalRepository focusSessionIntervalRepository;
    @Mock private DailyFocusStatRepository dailyFocusStatRepository;
    @Mock private PublicCommandService publicCommands;
    @Mock private OutboxCommandPort outboxCommandPort;
    @Mock private FocusPresencePort focusPresencePort;
    @Mock private FocusRewardPolicyRepository focusRewardPolicyRepository;
    @Mock private FocusSettlementRepository focusSettlementRepository;
    @Mock private IslandWalletService islandWalletService;
    @Mock private IslandWalletEvents islandWalletEvents;
    @Mock private FishWalletService fishWalletService;
    @Mock private User caller;
    @Mock private GroupMember membership;

    private FocusSessionLifecycleService service(Instant wallClock) {
        return service(wallClock, false);
    }

    private FocusSessionLifecycleService service(Instant wallClock, boolean startEnabled) {
        return new FocusSessionLifecycleService(new FocusSessionStartGate(startEnabled), userQueryService,
                membershipLocks, groupMemberRepository,
                userIslandContextLockService, focusSessionRepository, focusSessionDetailRepository,
                focusSessionIntervalRepository, dailyFocusStatRepository, publicCommands, new FocusMemberEvents(outboxCommandPort),
                focusRewardPolicyRepository, focusSettlementRepository, islandWalletService, islandWalletEvents,
                fishWalletService, focusPresencePort,
                Clock.fixed(wallClock, ZoneOffset.UTC));
    }

    // ── 1. 시작 게이트 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("start 는 활성화 설정(focus.session.start-enabled)이 꺼져 있으면 503 이다 — 행을 만들지 않는다")
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
    @DisplayName("게이트 판정은 입력 검증보다 앞이고, 기준은 설정 값 하나다 — 켜면 같은 입력이 400 으로 간다")
    void startGateWinsOverInputValidation() {
        assertThatThrownBy(() -> service(NOW).start(USER, null, KEY))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_START_UNAVAILABLE);

        // 같은 요청이 설정을 켠 인스턴스에서는 게이트를 지나 입력 검증에 걸린다 — 상수가 아니다.
        assertThatThrownBy(() -> service(NOW, true).start(USER, null, KEY))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.INVALID_SUBJECT);
    }

    @Test
    @DisplayName("열린 start 는 rest 투영 제거 사건과 프레즌스 리스를 함께 남긴다(선행 조건 #5·#9)")
    void startClearsTheRestProjectionAndLeasesPresence() {
        UUID sessionId = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000009");
        when(userQueryService.getCallerForUpdate(USER)).thenReturn(caller);
        when(focusSessionRepository.findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(caller))
                .thenReturn(Optional.empty());
        when(focusSessionDetailRepository.findFirstByUserIdAndLifecycleIn(eq(USER), any()))
                .thenReturn(Optional.empty());
        UserIslandContext context = UserIslandContext.newFor(USER);
        context.moveTo(ISLAND);
        when(userIslandContextLockService.lock(caller)).thenReturn(context);
        when(groupMemberRepository.findActiveByUserIdAndGroupIdForShare(USER, ISLAND))
                .thenReturn(Optional.of(membership));
        when(focusRewardPolicyRepository.findFirstByOrderByRevisionDesc()).thenReturn(Optional.of(
                FocusRewardPolicy.builder().revision(1).secondsPerFish(60).dailyCapFish(480)
                        .personalSharePercent(0).build()));
        when(focusSessionRepository.save(any(FocusSession.class)))
                .thenReturn(FocusSession.builder().id(sessionId).startedAt(NOW).presenceOrder(42L).build());
        when(focusSessionDetailRepository.save(any(FocusSessionDetail.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(outboxCommandPort.append(any())).thenAnswer(invocation -> envelope());
        when(publicCommands.run(any(), any(), any(), any())).thenAnswer(invocation -> {
            PublicCommandRequest request = invocation.getArgument(0);
            Supplier<PublicCommandResult> command = invocation.getArgument(3);
            return new IdempotentOutcome<>(PublicCommandReceipt.completed(request, command.get()), false);
        });

        service(NOW, true).start(USER, new FocusSessionStartCommandRequest(ISLAND, "알고리즘", 25), KEY);

        var captor = org.mockito.ArgumentCaptor.forClass(OutboxAppendCommand.class);
        verify(outboxCommandPort, times(2)).append(captor.capture());
        OutboxAppendCommand rest = captor.getAllValues().get(1);
        assertThat(rest.type()).isEqualTo("rest.member.updated");
        assertThat(rest.params()).containsEntry("status", "active").containsEntry("restSeat", null)
                .containsEntry("sessionId", sessionId.toString());
        verify(focusPresencePort).focusStarted(USER, 42L, NOW);
        // 섬 → 멤버십 순으로 잠근다(선행 조건 #8) — context 잠금 뒤다.
        InOrder order = inOrder(userIslandContextLockService, membershipLocks, groupMemberRepository);
        order.verify(userIslandContextLockService).lock(caller);
        order.verify(membershipLocks).lockGroup(ISLAND);
        order.verify(groupMemberRepository).findActiveByUserIdAndGroupIdForShare(USER, ISLAND);
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

    @Test
    @DisplayName("전이 시각은 DB 정밀도(마이크로초)로 자른다 — 응답·사건과 저장값이 같아야 재생이 원 결과와 같다")
    void transitionTimeIsTruncatedToTheStoredPrecision() {
        givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);

        FocusSessionView view = service(Instant.parse("2026-09-17T03:00:00.123456789Z"))
                .pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY);

        Instant stored = Instant.parse("2026-09-17T03:00:00.123456Z");
        assertThat(openInterval().getEndedAt()).isEqualTo(stored);
        assertThat(view.restStartedAt()).isEqualTo(stored);
    }

    // ── 4. summary 의 desync 감지 ─────────────────────────────────────────────

    @Test
    @DisplayName("summary 도 기본 마커가 닫힌 세션을 세지 않는다 — 안 그러면 합계가 계속 부푼다")
    void summaryDropsTheSessionWhoseMarkerWasClosedOutside() {
        FocusSessionDetail detail = detail(FocusSessionLifecycle.ACTIVE);
        when(focusSessionDetailRepository.findFirstByUserIdAndLifecycleIn(eq(USER), any()))
                .thenReturn(Optional.of(detail));
        // 레거시 start 가 닫아 둔 마커.
        when(focusSessionRepository.findEndedAtById(SESSION))
                .thenReturn(Optional.ofNullable(Instant.parse("2026-09-17T02:30:00Z")));
        when(focusSessionRepository.findPresenceOrderById(SESSION)).thenReturn(Optional.of(7L));
        when(dailyFocusStatRepository.findByUserAndDate(any(), any())).thenReturn(Optional.empty());

        var summary = service(NOW).summary(USER, "2026-09-17", "Asia/Seoul");

        assertThat(summary.currentSessionSecondsToday()).isZero();
        assertThat(summary.totalSeconds()).isZero();
        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.ABANDONED);
        // 구간은 «정리 사건»의 activeSeconds 를 위해 한 번만 읽는다 — 합계에는 들어가지 않는다(위 0).
        verify(focusSessionIntervalRepository, times(1)).findBySessionIdOrderByOrdinalAsc(SESSION);
        // 끝난 세션이라 리스를 지운다(선행 조건 #5).
        verify(focusPresencePort).focusEnded(USER, 7L);
    }

    // ── 5. 섬 소속 상실 ───────────────────────────────────────────────────────

    @Test
    @DisplayName("섬을 떠난 사용자의 pause 는 403 ISLAND_MEMBERSHIP_REQUIRED 다 — start 와 같은 코드다")
    void pauseIsRefusedWhenTheIslandMembershipIsGone() {
        FocusSessionDetail detail = givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);
        when(groupMemberRepository.findActiveByUserIdAndGroupIdForShare(USER, ISLAND)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service(NOW).pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);

        // 전이는 거절만 한다 — 종결은 강퇴 TX 의 몫이다(FR-D03, FocusMembershipLossService).
        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.ACTIVE);
        assertThat(detail.getVersion()).isEqualTo(1L);
        verify(focusSessionIntervalRepository, never()).save(any());
        verify(outboxCommandPort, never()).append(any());
    }

    @Test
    @DisplayName("강퇴된 사용자의 resume 도 같은 코드로 막힌다 — 비소속자가 섬 화면에 다시 뜨지 않는다")
    void resumeIsRefusedWhenTheIslandMembershipIsGone() {
        FocusSessionDetail detail = givenTransition(FocusSessionLifecycle.PAUSED, FocusIntervalKind.REST);
        when(groupMemberRepository.findActiveByUserIdAndGroupIdForShare(USER, ISLAND)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service(NOW).resume(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);

        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.PAUSED);
        verify(outboxCommandPort, never()).append(any());
    }

    @Test
    @DisplayName("멤버십이 살아 있으면 pause 는 평소대로 지나간다 — 검사가 정상 전이를 막지 않는다")
    void pauseStillPassesWhileTheMembershipIsAlive() {
        givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);

        assertThat(service(NOW).pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY).status())
                .isEqualTo(FocusSessionView.STATUS_PAUSED);
    }

    // ── 5-1. 잠금 순서(선행 조건 #8) ──────────────────────────────────────────────

    @Test
    @DisplayName("전이는 섬 행 → 멤버십(공유) → 상세 순으로 잠근다 — 강퇴와 섬 행에서 줄을 선다")
    void transitionLocksIslandThenMembershipBeforeTheDetail() {
        givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);

        service(NOW).pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY);

        InOrder order = inOrder(membershipLocks, groupMemberRepository, focusSessionDetailRepository);
        order.verify(focusSessionDetailRepository).findOwnershipBySessionId(SESSION);
        order.verify(membershipLocks).lockGroup(ISLAND);
        order.verify(groupMemberRepository).findActiveByUserIdAndGroupIdForShare(USER, ISLAND);
        order.verify(focusSessionDetailRepository).findBySessionIdForUpdate(SESSION);
    }

    @Test
    @DisplayName("주인이 아니면 섬도 멤버십도 잠그지 않고 403 이다 — 남의 섬 행을 잠가 줄 세우지 않는다")
    void foreignSessionIsRefusedBeforeAnyIslandLock() {
        givenTransition(FocusSessionLifecycle.ACTIVE, FocusIntervalKind.ACTIVE);
        when(focusSessionDetailRepository.findOwnershipBySessionId(SESSION))
                .thenReturn(Optional.of(new FocusSessionOwnership(UUID.randomUUID(), ISLAND)));

        assertThatThrownBy(() -> service(NOW).pause(USER, SESSION, new FocusVersionedCommandRequest(1L), KEY))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(membershipLocks, never()).lockGroup(any());
        verify(focusSessionDetailRepository, never()).findBySessionIdForUpdate(any());
    }

    // ── 6. 조회 스냅샷 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("current 는 REPEATABLE READ 다 — 상세와 구간을 한 스냅샷에서 읽는다(LLD §2)")
    void currentReadsInOneSnapshot() throws NoSuchMethodException {
        assertSingleSnapshot(FocusSessionLifecycleService.class.getMethod("current", UUID.class)
                .getAnnotation(Transactional.class), "current");
    }

    @Test
    @DisplayName("summary 도 REPEATABLE READ 다 — 완료 집계와 진행 구간을 한 스냅샷에서 읽는다(LLD §2)")
    void summaryReadsInOneSnapshot() throws NoSuchMethodException {
        assertSingleSnapshot(FocusSessionLifecycleService.class
                .getMethod("summary", UUID.class, String.class, String.class)
                .getAnnotation(Transactional.class), "summary");
    }

    private static void assertSingleSnapshot(Transactional tx, String method) {
        assertThat(tx).as("%s 에 @Transactional 이 있어야 한다", method).isNotNull();
        assertThat(tx.isolation())
                .as("%s 는 여러 SELECT 를 읽는다 — READ COMMITTED 면 문장마다 스냅샷이 갈린다", method)
                .isEqualTo(Isolation.REPEATABLE_READ);
        // readOnly 면 abandonIfMarkerClosed 의 정리 쓰기가 커밋되지 않는다(이미 겪었다).
        assertThat(tx.readOnly()).as("%s 는 정리 쓰기를 커밋해야 한다", method).isFalse();
        // 격리 수준은 «새 트랜잭션을 열 때만» 적용된다. REQUIRED 로 두면 이미 열린 트랜잭션 안에서
        // 불릴 때 조용히 기존 격리로 참여하고 위 isolation 이 무시된다 — 그래도 이 테스트는
        // 통과해 버리므로, 전파까지 함께 고정해야 검사가 거짓 안심이 되지 않는다.
        assertThat(tx.propagation())
                .as("%s 는 자기 트랜잭션을 열어야 격리 수준이 실제로 적용된다", method)
                .isEqualTo(Propagation.REQUIRES_NEW);
    }

    // ─────────────────────────────────────────────────────────────────────────

    /** pause/resume 이 실제로 명령 본문까지 들어가도록 잠금·멱등·이벤트 배선을 세운다. */
    private FocusSessionDetail givenTransition(FocusSessionLifecycle lifecycle, FocusIntervalKind openKind) {
        FocusSessionDetail detail = detail(lifecycle);
        when(focusSessionDetailRepository.findBySessionIdForUpdate(SESSION)).thenReturn(Optional.of(detail));
        when(userQueryService.getCallerForShare(USER)).thenReturn(caller);
        when(focusSessionDetailRepository.findOwnershipBySessionId(SESSION))
                .thenReturn(Optional.of(new FocusSessionOwnership(USER, ISLAND)));
        when(groupMemberRepository.findActiveByUserIdAndGroupIdForShare(USER, ISLAND))
                .thenReturn(Optional.of(membership));
        when(focusSessionRepository.findEndedAtById(SESSION)).thenReturn(Optional.ofNullable(null));
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


    private static EventEnvelope envelope() {
        return new EventEnvelope(UUID.randomUUID().toString(), 1, "focus.member.updated", NOW, null,
                USER, null, USER.toString(), 1L, Map.of());
    }
}

package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.repository.FocusRewardPolicyRepository;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusSettlementRepository;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusSessionStartGate;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.focus.service.FocusMemberEvents;
import com.oneorthree.phone.focus.service.FocusPresenceProjection;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * GROMO-1764 후속: 기본 {@code focus_sessions} 마커가 바깥에서 닫힌 세션을 새 수명주기 경로가
 * 어떻게 다루는지 고정한다.
 *
 * <p>레거시 {@code FocusService.startFocusSession}이 {@code autoCloseOpenMarkersOf}로 그 사용자의
 * 열린 마커를 전부 닫으면 v0.3 세션의 기본 행도 같이 닫힌다. 그때 상세만 ACTIVE로 남으면
 * {@code current}가 "진행 중"이라 거짓말을 하고, V58 부분 UNIQUE 때문에 그 사용자는 이후 start마다
 * 500을 받는다. 이 테스트는 <b>current가 그 행을 ABANDONED로 내리고 「없음」으로 답하는지</b>와
 * <b>정상 세션은 그대로 보이는지</b>를 본다.
 *
 * <p>Testcontainers를 쓰지 않는다 — 판정 로직 자체가 회귀 지점이라 DB 없이 볼 수 있다.
 */
@ExtendWith(MockitoExtension.class)
class FocusSessionMarkerDesyncTest {

    private static final Instant NOW = Instant.parse("2026-09-17T03:00:00Z");
    private static final Instant STARTED_AT = Instant.parse("2026-09-17T02:00:00Z");

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
    @Mock private FocusRewardAccrualRepository focusRewardAccrualRepository;
    @Mock private FocusRewardAccrualService rewardAccruals;

    private FocusSessionLifecycleService service() {
        return new FocusSessionLifecycleService(new FocusSessionStartGate(false), userQueryService,
                membershipLocks, groupMemberRepository,
                userIslandContextLockService, focusSessionRepository, focusSessionDetailRepository,
                focusSessionIntervalRepository, dailyFocusStatRepository, publicCommands,
                focusRewardPolicyRepository, focusSettlementRepository, focusRewardAccrualRepository, rewardAccruals,
                new FocusPresenceProjection(new FocusMemberEvents(outboxCommandPort), focusPresencePort),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void current_기본마커가_바깥에서_닫혔으면_상세를_ABANDONED로_내리고_없음으로_답한다() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        FocusSessionDetail detail = detail(sessionId, userId, FocusSessionLifecycle.ACTIVE);
        when(focusSessionDetailRepository.findFirstByUserIdAndLifecycleIn(eq(userId), any()))
                .thenReturn(Optional.of(detail));
        // 레거시 start가 닫아 둔 마커 — endedAt이 차 있다.
        when(focusSessionRepository.findEndedAtById(sessionId))
                .thenReturn(Optional.ofNullable(Instant.parse("2026-09-17T02:30:00Z")));

        assertThat(service().current(userId)).isNull();
        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.ABANDONED);
        assertThat(detail.getRestSeat()).isNull();
        assertThat(detail.getVersion()).isEqualTo(2L);
        assertThat(detail.getLastTransitionAt()).isEqualTo(NOW);
    }

    @Test
    void current_기본마커가_열려있으면_평소대로_진행중_세션을_돌려준다() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        FocusSessionDetail detail = detail(sessionId, userId, FocusSessionLifecycle.ACTIVE);
        when(focusSessionDetailRepository.findFirstByUserIdAndLifecycleIn(eq(userId), any()))
                .thenReturn(Optional.of(detail));
        when(focusSessionRepository.findEndedAtById(sessionId)).thenReturn(Optional.ofNullable(null));
        when(focusSessionIntervalRepository.findBySessionIdOrderByOrdinalAsc(sessionId))
                .thenReturn(List.of(FocusSessionInterval.builder()
                        .sessionId(sessionId)
                        .ordinal(1)
                        .kind(FocusIntervalKind.ACTIVE)
                        .startedAt(STARTED_AT)
                        .build()));

        FocusSessionView view = service().current(userId);

        assertThat(view).isNotNull();
        assertThat(view.status()).isEqualTo(FocusSessionView.STATUS_ACTIVE);
        assertThat(view.activeSeconds()).isEqualTo(3600L);
        assertThat(detail.getLifecycle()).isEqualTo(FocusSessionLifecycle.ACTIVE);
        assertThat(detail.getVersion()).isEqualTo(1L);
    }

    private static FocusSessionDetail detail(UUID sessionId, UUID userId, FocusSessionLifecycle lifecycle) {
        return FocusSessionDetail.builder()
                .sessionId(sessionId)
                .userId(userId)
                .islandId(UUID.randomUUID())
                .membershipEpochAtStart(1L)
                .subject("알고리즘")
                .targetMinutes(60)
                .lifecycle(lifecycle)
                .version(1L)
                .lastTransitionAt(STARTED_AT)
                .build();
    }

}

package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.port.BetSettlementClock;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * {@code closeShortOrUnused} 참가 마감 판정({@code effectiveJoinDeadline}, GROMO-2135)의
 * <b>±1초 경계</b>를 못박는다.
 *
 * <p><b>왜 별도 테스트인가.</b> 이 클래스엔 기존 단위 테스트가 없다(정산 본체는
 * {@code GroupBetSettlementIntegrationTest} 가 실 DB 로 본다) — 실 시스템 시계로는 마감 정각에
 * 인원 미달 무산이 통과하는지(isBefore 미만 판정)를 정확한 초 단위로 고정할 수 없다.
 * {@link GroupBetJoinDeadlineBoundaryTest} 와 같은 최소 경로 원칙 — 가드 판정까지만 세운다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetSettlerCloseDeadlineBoundaryTest {

    private static final UUID SESSION_ID = UUID.randomUUID();
    /** 참가 마감(= closesAt, 브리지 기간). */
    private static final Instant DEADLINE = Instant.parse("2026-08-01T15:00:00Z");

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private GroupQueryService groupQueryService;
    @Mock
    private FocusSessionRepository focusSessionRepository;
    @Mock
    private CurrencyLedgerService currencyLedgerService;
    @Mock
    private GroupBetJudge groupBetJudge;
    @Mock
    private ApplicationEventPublisher eventPublisher;
    @Mock
    private BetSettlementClock resultBundles;
    @Mock
    private Clock clock;

    @InjectMocks
    private GroupBetSettler groupBetSettler;

    private GroupChallengeBetSession openSession() {
        return GroupChallengeBetSession.builder()
                .id(SESSION_ID)
                .closesAt(DEADLINE)
                .build();
    }

    @Test
    @DisplayName("마감 1초 전(14:59:59Z) — 아직 마감 전이라 인원 조회 없이 스킵한다")
    void oneSecondBeforeDeadlineSkips() {
        GroupChallengeBetSession session = openSession();
        given(groupQueryService.getBetSessionForUpdate(SESSION_ID)).willReturn(session);
        given(clock.instant()).willReturn(DEADLINE.minusSeconds(1));

        GroupBetSettler.SettleResult result = groupBetSettler.closeShortOrUnused(SESSION_ID);

        assertThat(result).isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.OPEN, false));
        verify(groupChallengeBetParticipantRepository, never()).findBySessionIdIn(any());
    }

    @Test
    @DisplayName("마감 정각(15:00:00Z) — 가드를 통과해 인원 미달(0명) 종료까지 진행한다(isBefore 는 정각을 포함하지 않는다)")
    void atDeadlineProceedsPastGuard() {
        GroupChallengeBetSession session = openSession();
        given(groupQueryService.getBetSessionForUpdate(SESSION_ID)).willReturn(session);
        given(clock.instant()).willReturn(DEADLINE);
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(SESSION_ID)))
                .willReturn(List.of());
        given(groupChallengeBetSessionRepository.compareAndSetSettled(
                SESSION_ID, GroupBetStatus.UNUSED, null, DEADLINE))
                .willReturn(1);

        GroupBetSettler.SettleResult result = groupBetSettler.closeShortOrUnused(SESSION_ID);

        assertThat(result).isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.UNUSED, true));
        verify(groupChallengeBetParticipantRepository).findBySessionIdIn(List.of(SESSION_ID));
    }
}

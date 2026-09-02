package com.oneorthree.phone.group.listener;

import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.SettleTrigger;
import com.oneorthree.phone.group.event.GroupBetWonEvent;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.service.GroupBetSettler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import java.time.Instant;

/**
 * 전원 확정 → 조기 정산 트리거(GROMO-1268, N11) — {@link GroupBetWonEvent} 를
 * {@code AFTER_COMMIT} 으로 받아 검사한다. 커밋 후 검사여야 마지막 두 명이 동시에 확정돼도
 * 늦게 커밋한 쪽 리스너가 반드시 전원 확정을 본다(트랜잭션 안 검사는 write skew — LLD §5.1).
 *
 * <p><b>{@code GroupBetSettler} 와 다른 빈이다</b> — 정산 호출이 자기 호출(self-invocation)이면
 * {@code @Transactional} 프록시를 타지 않아 회차 락·정산·지급의 원자 경계가 사라진다. 여기서의
 * 무락 사전 검사(마감·전원 확정)는 낡았을 수 있으므로 최종 판정은 {@code settle(EARLY)} 가 회차
 * 락 안에서 다시 한다.
 *
 * <p>참가 마감 가드를 생략하면 회차가 조기에 닫힌다 — 하루형은 참가 마감이 자정(= 회차 종료)이라
 * "전원 확정"이어도 아직 들어올 사람이 남아 있다. 결과적으로 조기 정산은 <b>창형에서만 발동</b>한다
 * ({@code 참가 마감 = 창 시작 < 회차 종료}). 실패는 삼킨다 — 5분 크론이 어차피 회수한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GroupBetEarlySettlementListener {

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final GroupBetSettler groupBetSettler;

    /**
     * 확정 이벤트를 커밋 뒤에 받아 조기 정산 조건을 검사한다.
     *
     * <p>회차가 이미 사라졌거나 닫혔거나, 참가 마감 전이거나, 미확정 참가자가 남아 있으면 아무것도
     * 하지 않는다. 셋을 다 통과해야 {@code settle(EARLY)} 를 부르고, 그 호출이 던지는 예외는 삼킨다 —
     * 조기 정산은 최적화 경로라 실패해도 5분 크론이 {@code settle_after} 에 같은 회차를 회수한다.
     * 여기서의 검사는 무락이라 낡았을 수 있고, 최종 판정은 회차 락 안에서 다시 이뤄진다.
     *
     * @param event 방금 확정된 참가가 속한 회차 — 회차 행이 없으면 조용히 반환한다
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onBetWon(GroupBetWonEvent event) {
        GroupChallengeBetSession session =
                groupChallengeBetSessionRepository.findById(event.sessionId()).orElse(null);
        if (session == null || !session.isOpen()) {
            return;
        }
        // 실효 참가 마감(브리지 기간 = closes_at) — settle 의 락 안 재검증과 <b>같은 기준</b>이어야
        // 한다. 여기만 박제된 join_closes_at 을 보면 창 진행 중에 settle 을 불러 매번 스킵당한다.
        if (Instant.now().isBefore(GroupBetSettler.effectiveJoinDeadline(session))) {
            return;   // 생략하면 안 된다 — 아직 들어올 사람이 남아 있다.
        }
        if (groupChallengeBetParticipantRepository
                .countBySessionIdAndAchievedIsNull(event.sessionId()) > 0) {
            return;   // 커밋된 상태 기준 미확정 잔존.
        }
        try {
            groupBetSettler.settle(event.sessionId(), SettleTrigger.EARLY);
        } catch (RuntimeException e) {
            // 조기 정산은 최적화 경로다 — 실패해도 5분 크론이 settle_after 에 정산한다.
            log.error("조기 정산 실패 — 크론 재시도로 회수. sessionId={}", event.sessionId(), e);
        }
    }
}

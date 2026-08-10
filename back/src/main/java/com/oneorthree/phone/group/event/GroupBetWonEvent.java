package com.oneorthree.phone.group.event;

import java.util.UUID;

/**
 * 회차 참가자의 <b>개인 승리가 조기 확정</b>됐다는 도메인 이벤트 (GROMO-1268, N11).
 *
 * <p>{@code GroupBetEarlyWinConfirmer.confirmWins} 가 집중 세션 저장 트랜잭션 안에서 발행한다.
 * 소비자는 둘이며 <b>서로 독립</b>이다:
 * <ol>
 *   <li>{@code GroupBetEarlySettlementListener} — 전원 확정이면 조기 정산({@code settle(EARLY)})</li>
 *   <li><b>승리 확정 푸시 {@code BET_WON}</b>(PRD FR-43 — "목표를 채운 순간, 본인에게") —
 *       <b>알림 파이프라인 소유자인 B7(GROMO-1283 계열)이 소비자를 배선한다.</b> 정산 트리거와
 *       한 리스너로 묶으면 안 된다: 정산 리스너는 전원 확정이 아니면 즉시 반환하므로, 혼자 먼저
 *       달성한 사람에게는 알림이 영영 안 간다</li>
 * </ol>
 *
 * <p>전원 확정 검사를 발행 트랜잭션 <b>안</b>에서 하면 마지막 두 명이 동시에 확정될 때 서로의
 * 미커밋 행을 미확정으로 보고 둘 다 건너뛴다(write skew) — 커밋 후({@code AFTER_COMMIT}) 재검사면
 * 늦게 커밋한 쪽 리스너가 반드시 전원 확정을 본다(LLD §5.1).
 *
 * <p>엔티티가 아니라 <b>식별자만</b> 싣는다. 리스너는 커밋 이후 별도 트랜잭션에서 돌기 때문에
 * 발행 시점의 영속성 컨텍스트가 없고, 엔티티를 그대로 실으면 지연 로딩이 터진다. 알림 소비자가
 * 필요로 하는 축(수신자·딥링크 대상)을 함께 실어 두어 B7 이 회차를 다시 조회하지 않아도 되게 한다
 * (IA §푸시: {@code BET_WON} 의 payload 는 {@code groupId} + {@code challengeId}).
 *
 * @param sessionId     회차 id — 정산 리스너가 회차(참가 마감·미확정 수)를 조회하므로 반드시 싣는다
 *                      (participantId 만 실으면 조기 정산이 영영 안 돈다)
 * @param participantId 승리가 확정된 참가 행 id — 돈 흐름 멱등키의 축(FR-42)
 * @param userId        승리한 <b>본인</b> — {@code BET_WON} 수신자(FR-43)
 * @param groupId       딥링크 대상 그룹(IA §푸시 payload)
 * @param challengeId   딥링크 대상 챌린지(IA §푸시 payload)
 */
public record GroupBetWonEvent(
        UUID sessionId,
        UUID participantId,
        UUID userId,
        UUID groupId,
        UUID challengeId) {
}

package com.oneorthree.phone.group.event;

import java.util.UUID;

/**
 * 회차 참가자의 <b>개인 승리가 조기 확정</b>됐다는 도메인 이벤트 (GROMO-1268, N11).
 *
 * <p>{@code GroupBetEarlyWinConfirmer.confirmWins} 가 집중 세션 저장 트랜잭션 안에서 발행하고,
 * {@code GroupBetEarlySettlementListener} 가 {@code AFTER_COMMIT} 으로 받아 "전원 확정 → 조기
 * 정산"을 검사한다. 전원 확정 검사를 발행 트랜잭션 <b>안</b>에서 하면 마지막 두 명이 동시에
 * 확정될 때 서로의 미커밋 행을 미확정으로 보고 둘 다 건너뛴다(write skew) — 커밋 후 재검사면
 * 늦게 커밋한 쪽 리스너가 반드시 전원 확정을 본다(LLD §5.1).
 *
 * @param sessionId     회차 id — 리스너가 회차(참가 마감·미확정 수)를 조회하므로 반드시 싣는다
 *                      (participantId 만 실으면 조기 정산이 영영 안 돈다)
 * @param participantId 승리가 확정된 참가 행 id
 */
public record GroupBetWonEvent(UUID sessionId, UUID participantId) {
}

package com.oneorthree.phone.group.event;

import java.util.UUID;

/**
 * 회차가 <b>돈이 움직인 채</b> 종료됐다는 도메인 이벤트(GROMO-1417) — 정산(SETTLED·FORFEITED)과
 * 무효화+환불(VOIDED·REFUNDED) 커밋 직후의 알림 트리거다.
 *
 * <p>{@code GroupBetSettler} 가 상태 전이 트랜잭션 <b>안</b>에서 발행하고, 알림 리스너가
 * {@code AFTER_COMMIT} 으로 받아 사건 단위 파이프라인(클레임 → 묶음 → 발송)에 태운다 —
 * 환불 커밋 <b>전</b>에 발송되는 일이 구조적으로 없다(N48: BET_VOID_REFUND 는 "무효화+환불
 * 커밋 직후"). 정산 결과도 같은 경로다 — 종전 일 2회(08:00·13:00) 배치만으로는 당일 정산의
 * 즉시성이 없었다(B4 잔여 문제 해소).
 *
 * <p>payload 를 회차 id 하나로 좁힌 이유: CAS 벌크 UPDATE 가 영속성 컨텍스트를 우회하므로
 * 발행 시점 엔티티 상태는 낡아 있다 — 리스너가 커밋된 행을 다시 읽어 상태·사유를 판정한다.
 * UNUSED(0명 종료)는 발행하지 않는다(N52 — 알림 제외).
 *
 * @param sessionId 종료된 회차 id
 */
public record GroupBetSessionClosedEvent(UUID sessionId) {
}

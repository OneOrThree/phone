package com.oneorthree.realtime.movement;

/**
 * 앱 → 서버 이동 요청(계약 §2). 목적지만 싣는다 — <b>출발점 필드가 없다</b>: 경로의 출발은 항상 서버가
 * 기록한 actor 의 현재 위치이고, 클라이언트가 보낸 어떤 값도 출발점으로 쓰이지 않는다
 * ({@code RoomRuntimeTest#moveIntentHasNoClientSuppliedStartField} 가 이 record 모양을 고정한다).
 *
 * @param commandSeq   세션 안에서 1부터 증가하는 명령 번호.
 * @param navRevision  클라이언트가 들고 있는 nav 버전 — {@link MovementRules#navRevision()} 과 다르면 거절.
 * @param goalX        목적지 월드 x.
 * @param goalY        목적지 월드 y.
 */
public record MoveIntent(long commandSeq, int navRevision, double goalX, double goalY) {
}

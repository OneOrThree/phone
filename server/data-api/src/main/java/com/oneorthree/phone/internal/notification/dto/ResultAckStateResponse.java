package com.oneorthree.phone.internal.notification.dto;

import java.time.Instant;

/**
 * 정본 ack 상태 — <b>알림 서버의 자기 수렴 경로</b> (조회 3종의 두 번째 · A22 ⓓ).
 *
 * <h2>왜 이 조회가 있어야 하는가</h2>
 * 결과 표시 선점의 {@code HELD} 리스가 만료되면 알림 서버는 {@code NEEDS_CONFIRM} 으로 넘어가
 * flush 를 계속 건너뛴다. 그 상태를 푸는 길은 셋뿐이다 — {@code commit} · {@code abort} · 그리고
 * <b>이 조회</b>. 「롤백 직후 프로세스가 죽는 구간」에서는 abort 행이 아예 생기지 않으므로 앞의 둘이
 * 오지 않고, 그때 이 조회가 <b>유일한 탈출구</b>가 된다. 없으면 그 회차의 결과 푸시는 영구 억제된다.
 *
 * <h2>행이 없어도 404 가 아니다</h2>
 * 「아직 확인되지 않았다」와 「그 참가 행이 없다」는 <b>억제를 푸는 쪽에서는 결론이 같다</b>(둘 다
 * 「확인 표시 없음」). 여기서 404 를 던지면 수렴 경로가 그 예외에 막혀, 탈출구를 두고도 못 빠져나온다.
 * 그래서 {@code {acknowledged:false, acknowledgedAt:null}} 을 그대로 돌려준다.
 *
 * @param acknowledged   확인 표시가 찍혔는가
 * @param acknowledgedAt 확인 시각. 미확인이면 {@code null}
 */
public record ResultAckStateResponse(boolean acknowledged, Instant acknowledgedAt) {
}

package com.oneorthree.phone.outbox.service;

import java.util.UUID;

/**
 * 직접 전달에 성공한 호출자가 <b>알림 대상 전달 하나를 닫는</b> 공개 포트 (A22 ㊿ · ㊲).
 *
 * <h2>왜 이 경로가 따로 있는가</h2>
 * ㊲·㊿ 의 순서가 그대로 계약이다 — 기기 토큰 삭제처럼 앱이 실패를 삼키는 명령은, 시도 <b>전에</b>
 * outbox 를 기록하고 그다음 직접 전달을 시도해 <b>성공했을 때 완료로 표시</b>한다. 실패한 뒤에야
 * 기록하면 그 사이에 죽었을 때 둘 다 안 남는다.
 *
 * <p>그래서 이 포트는 「보낸다」가 아니라 「보냈다고 표시한다」만 한다. 직접 전달 자체는 호출자가
 * 한다 — Data 가 위성에 동기 호출을 하면 §3 의 단방향 규칙이 깨진다.
 *
 * <h2>이 포트가 지키는 것</h2>
 * <ul>
 *   <li><b>소유</b> — 봉투의 수신자가 인증된 요청자여야 한다. 남의 명령 id 로는 아무것도 못 닫는다.
 *   <li><b>대상 고정</b> — 닫는 것은 {@code NOTI} 뿐이다. 대상은 <b>인자가 아니라</b> 질의에 박혀 있어,
 *       같은 경로로 Kafka·링크 전달까지 「보냈다」고 표시할 길이 없다.
 *   <li><b>먼저 실패한 다른 대상을 건드리지 않는다</b> — 링크 전달이 실패해 남아 있어도 그 행은
 *       그대로다. relay 가 계속 재시도한다.
 *   <li><b>relay 펜싱 유지</b> — 리스가 살아 있는 행을 닫아도, 그 워커의 뒤늦은 성공·실패 표시는
 *       {@code deliveredAt IS NULL} 조건에 걸려 0행이다. 낡은 relay ack 이 이 결과를 덮지 못한다.
 * </ul>
 *
 * <h2>순서에 대해 — 알아 두어야 할 한계</h2>
 * 이 경로는 relay 의 순서 보장(같은 축의 선행 미전달을 건너뛰지 않는다) <b>밖</b>에서 돈다. 축의 앞
 * 사건이 아직 미전달이어도 이 호출은 뒤 사건을 닫는다. 그래서 <b>수신 측이 순서와 무관해야 하는
 * 명령에만</b> 쓴다 — 기기 토큰 삭제처럼 멱등이고 소유권 값({@code ownershipVersion})으로 스스로
 * 늦은 적용을 막는 명령이 그렇다(㊨). 전체 상태와 version으로 역순 적용을 거부하는 설정 명령에도 쓸 수 있다.
 * version 없이 상태를 덮는 명령에는 쓰지 않는다.
 */
public interface OutboxDeliveryAckPort {

    /**
     * 알림 대상 전달을 완료로 표시한다.
     *
     * @param callerUserId 인증된 요청자 — 봉투의 수신자와 같아야 한다
     * @param outboxId     명령 응답으로 받은 봉투 id
     * @return 이번 호출이 닫았는지, 이미 닫혀 있었는지
     * @throws com.oneorthree.phone.outbox.exception.OutboxException 대상이 없거나 요청자의 것이
     *     아니거나 그 명령에 알림 대상이 없을 때 — 셋을 한 코드로 합친다(존재 노출 방지)
     */
    AckOutcome acknowledgeNotificationDelivery(UUID callerUserId, UUID outboxId);

    /**
     * 공개 봉투의 사건 키로 알림 대상 전달을 닫는다. 저장소 내부 UUID와 혼동하지 않는다.
     *
     * @param callerUserId 인증된 요청자
     * @param eventId append 응답의 eventId (요청 명령은 commandId의 문자열)
     * @return 이번 호출이 닫았는지, 이미 닫혀 있었는지
     */
    AckOutcome acknowledgeNotificationDelivery(UUID callerUserId, String eventId);

    /** 빠른 완료표시의 결과. */
    enum AckOutcome {

        /** 이번 호출이 닫았다. */
        MARKED,

        /**
         * 이미 닫혀 있었다 — 재시도이거나 relay 가 먼저 보낸 것이다. 호출자에게는 성공과 같다
         * (멱등), 다만 관측을 위해 구분해 둔다.
         */
        ALREADY_MARKED
    }
}

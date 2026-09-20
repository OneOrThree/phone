package com.oneorthree.realtime.event;

import java.util.Set;
import java.util.UUID;

/**
 * {@code chat:events:v1} 에 실려 다니는 한 건 — 「이 목적지로 이 사건을 밀어라」.
 *
 * <p>{@code ChatFanoutEvent} 와 모양이 비슷하지만 <b>같은 채널을 쓰지 않는다</b>(realtime-events LLD §7:
 * 기존 {@code chat:fanout} payload 는 호환 대상이고 신규 도메인 사건을 같은 wire 로 섞지 않는다).
 *
 * <p><b>audience 가 아니라 목적지를 싣는다.</b> {@link RealtimeAudience} 는 sealed interface 라 다형
 * 직렬화 타입 정보가 필요한데, 받는 쪽이 정작 필요한 것은 「어느 목적지로 미는가」 하나뿐이다. 수신
 * 대상 판정({@link EventRouter})은 <b>발행한 인스턴스가 이미 끝낸</b> 일이고, 그 결과가 곧 이 문자열이다.
 *
 * @param originInstanceId 발행한 인스턴스. 받는 쪽이 <b>자기 메아리를 걸러내는</b> 데 쓴다 —
 *                         Redis Pub/Sub 는 발행자에게도 되돌려 주므로, 없으면 발행 인스턴스에 붙은
 *                         구독자만 같은 사건을 두 번 받는다
 * @param destination      브로커 목적지 — {@code EventRouter} 가 계산한 값 그대로다
 * @param event            앱이 받는 7필드 봉투
 * @param recipients       수신 제한 — 비어 있으면 그 목적지 구독자 전부. 응원처럼 수신 자격이 구독
 *                         인가보다 좁은 채널만 채운다. <b>이 봉투는 내부용이라 클라이언트에 가지 않으므로</b>
 *                         여기에 사용자 목록을 실어도 남의 화면에 노출되지 않는다
 */
public record RealtimeEventFanoutEvent(
        UUID originInstanceId,
        String destination,
        RealtimeEventEnvelope event,
        Set<UUID> recipients
) {
    public RealtimeEventFanoutEvent {
        recipients = recipients == null ? Set.of() : Set.copyOf(recipients);
    }
}

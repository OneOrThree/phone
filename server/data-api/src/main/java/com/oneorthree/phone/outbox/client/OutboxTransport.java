package com.oneorthree.phone.outbox.client;

import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;

import java.util.UUID;

/**
 * 프로세스 밖으로 나가는 전달 경로 — 대상 하나를 맡는다 (규약 §2: {@code client/}).
 *
 * <p><b>구현은 트랜잭션 밖에서 불린다.</b> relay 가 선점(TX1) → 전달(여기, TX 없음) → 표시(TX2) 로
 * 나눠 부른다. 여기서 DB 를 건드리면 그 분리가 무의미해진다.
 *
 * <p><b>대상 간 자동 폴백은 없다.</b> Kafka 가 죽었다고 HTTP 로 우회하지 않는다 — A18 이 아직 그
 * 정책을 정하지 않았고, 같은 EC2 라 함께 죽을 확률도 크다.
 */
public interface OutboxTransport {

    /**
     * @return 이 구현이 맡는 대상
     */
    OutboxTarget target();

    /**
     * 한 건을 전달한다.
     *
     * @param delivery 보낼 전달 행 — payload·endpointKey 가 여기 있다
     * @param userId   봉투의 수신자. Kafka 키이자 HTTP 경로 자리표시자의 <b>유일한</b> 출처다
     * @return 전달 결과
     */
    OutboxTransportResult send(EventOutboxDelivery delivery, UUID userId);
}

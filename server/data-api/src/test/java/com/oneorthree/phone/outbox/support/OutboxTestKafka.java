package com.oneorthree.phone.outbox.support;

import org.testcontainers.DockerClientFactory;
import org.testcontainers.kafka.KafkaContainer;

/**
 * relay 통합 테스트용 <b>진짜 브로커</b>.
 *
 * <p>이미지를 {@code apache/kafka} 로 잡은 것은 의도다 — {@code server/scripts/docker-compose.kafka.yml}
 * 이 띄우는 것과 <b>같은 배포물</b>이어야 「테스트에선 되는데 dev 에선 안 된다」가 줄어든다.
 * {@code KafkaContainer} 는 KRaft 단일 노드로 뜨고 내부 토픽 복제 계수도 1 로 맞춘다.
 */
public final class OutboxTestKafka {

    /** JVM 하나당 브로커 하나. */
    public static final KafkaContainer INSTANCE;

    static {
        INSTANCE = new KafkaContainer("apache/kafka:3.8.1");
        INSTANCE.start();
    }

    private OutboxTestKafka() {
    }

    /**
     * 브로커를 <b>실제로</b> 멈춘다 — 포트는 그대로 두고 프로세스만 얼린다.
     *
     * <p>컨테이너를 stop 하면 재기동 때 포트가 바뀌어 「같은 브로커가 돌아왔다」가 아니게 된다.
     * 발행 실패 후 <b>같은 주소로</b> 재전달되는지를 보려면 일시정지가 맞다.
     */
    public static void pause() {
        DockerClientFactory.instance().client()
                .pauseContainerCmd(INSTANCE.getContainerId()).exec();
    }

    /** 멈춘 브로커를 되살린다. */
    public static void unpause() {
        DockerClientFactory.instance().client()
                .unpauseContainerCmd(INSTANCE.getContainerId()).exec();
    }
}

package com.oneorthree.phone.config;

import com.oneorthree.phone.outbox.client.HttpOutboxTransport;
import com.oneorthree.phone.outbox.client.KafkaOutboxTransport;
import com.oneorthree.phone.outbox.client.OutboxTransport;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.scheduler.OutboxRelayScheduler;
import com.oneorthree.phone.outbox.service.OutboxRelayService;
import com.oneorthree.phone.outbox.service.OutboxRelayStore;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.kafka.autoconfigure.KafkaProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;
import org.springframework.web.client.RestClient;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * outbox relay 배선 — <b>켜졌을 때만</b> 빈을 만든다 (GROMO-1659/1660 공통 기반).
 *
 * <p>기본이 꺼짐인 이유는 {@link OutboxRelayProperties} 에 적었다: 이 기반이 들어가는 시점에 브로커도
 * 위성 서비스도 아직 없어서, 켜진 채로 들어가면 기존 앱 기동이 매 틱 연결 타임아웃을 문다.
 *
 * <p><b>봉투를 적는 쪽({@code OutboxCommandService})은 이 설정과 무관하게 항상 살아 있다.</b>
 * relay 가 꺼져 있어도 내구 기록은 남아야 한다 — 나중에 켜면 그때 밀린 분이 나간다. 꺼진 동안 쌓인
 * 행을 버리면 기반을 넣는 의미가 없다.
 *
 * <p>설정 검증은 <b>생성자</b>에서 한다. 이 클래스 자체가 「켜짐」 조건으로만 로드되므로, 여기 도달한
 * 시점이 곧 「켰다」이고 그때 재시도 정책이 비어 있으면 <b>기동을 거부</b>한다 — 값 없이 켜지면 코드의
 * 임의 기본값이 곧 운영 정책이 되는데, A18 이 아직 그 정책을 정하지 않았다.
 */
@Configuration
@EnableConfigurationProperties(OutboxRelayProperties.class)
@ConditionalOnProperty(prefix = "outbox.relay", name = "enabled", havingValue = "true")
public class OutboxRelayConfig {

    private final OutboxRelayProperties properties;

    /**
     * @param properties relay 설정 — 여기서 곧바로 검증한다
     */
    public OutboxRelayConfig(OutboxRelayProperties properties) {
        properties.validateWhenEnabled();
        this.properties = properties;
    }

    /**
     * @param deliveryRepository 전달 상태 저장소
     * @param clock              서버 시계
     * @return relay 의 트랜잭션 경계
     */
    @Bean
    public OutboxRelayStore outboxRelayStore(EventOutboxDeliveryRepository deliveryRepository, Clock clock) {
        return new OutboxRelayStore(deliveryRepository, properties, clock);
    }

    /**
     * 위성 호출 전용 HTTP 클라이언트 — 목적지는 오직 허용목록에서만 온다.
     *
     * <p><b>타임아웃을 명시한다.</b> 타임아웃 없는 클라이언트는 위성이 응답하지 않을 때 relay 스레드를
     * 무한정 붙잡고, 그 동안 미전달이 쌓인다 — 같은 실수가 FCM 경로에서 실제 사고를 냈다
     * ({@code FriendshipRepository} 주석). 저장소 관례대로 {@code RestClient.builder()} 를 직접 쓴다.
     *
     * @return 클라이언트
     */
    @Bean
    public RestClient outboxRestClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(properties.getHttpConnectTimeout());
        factory.setReadTimeout(properties.getHttpReadTimeout());
        return RestClient.builder().requestFactory(factory).build();
    }

    /**
     * outbox 전용 프로듀서 — <b>봉투는 문자열 JSON</b>이라 직렬화기를 String 으로 못 박는다.
     *
     * <p>오토컨피그의 {@code KafkaTemplate<Object, Object>} 를 그대로 쓰지 않는 이유는 둘이다:
     * ① 제네릭이 달라 주입이 풀리지 않고, ② 여기서 정하는 것이 <b>전달 보장</b>이다.
     *
     * <p>{@code acks=all} + {@code enable.idempotence=true} 로 둔다. 단일 노드라 {@code acks=all} 은
     * 사실상 {@code acks=1} 이지만, 관리형으로 승격할 때 이 값이 기본이어야 「승격했더니 유실이
     * 생겼다」가 없다. 멱등 프로듀서는 <b>프로듀서 내부 재시도</b>의 중복을 없앤다 — relay 재전달의
     * 중복(at-least-once)은 그것과 별개이고 수신 측 {@code eventId} 멱등이 받는다.
     *
     * @param kafkaProperties {@code spring.kafka.*}
     * @return 프로듀서 팩토리
     */
    @Bean
    public ProducerFactory<String, String> outboxProducerFactory(KafkaProperties kafkaProperties) {
        Map<String, Object> config = kafkaProperties.buildProducerProperties();
        config.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        config.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        config.put(ProducerConfig.ACKS_CONFIG, "all");
        config.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        return new DefaultKafkaProducerFactory<>(config);
    }

    /**
     * @param outboxProducerFactory outbox 전용 프로듀서 팩토리
     * @return 발행구
     */
    @Bean
    public KafkaTemplate<String, String> outboxKafkaTemplate(
            ProducerFactory<String, String> outboxProducerFactory) {
        return new KafkaTemplate<>(outboxProducerFactory);
    }

    /**
     * relay 본체.
     *
     * <p>전달 경로를 <b>빈으로 노출하지 않고</b> 여기서 조립한다 — {@code List<OutboxTransport>} 빈과
     * 개별 {@code OutboxTransport} 빈이 섞이면 주입이 어느 쪽으로 풀릴지가 배선 순서에 달린다.
     *
     * <p>HTTP 대상은 <b>허용목록에 그 대상의 엔드포인트가 하나라도 있을 때만</b> 만든다. 목적지가
     * 없는데 경로만 열어 두면 「켰는데 왜 안 가지」가 로그 없이 조용히 성립한다.
     *
     * @param store            트랜잭션 경계
     * @param outboxRepository 봉투 저장소
     * @param outboxKafkaTemplate Kafka 발행구
     * @param outboxRestClient 위성 호출 클라이언트
     * @param clock            서버 시계
     * @return relay 본체
     */
    @Bean
    public OutboxRelayService outboxRelayService(
            OutboxRelayStore store,
            EventOutboxRepository outboxRepository,
            KafkaTemplate<String, String> outboxKafkaTemplate,
            RestClient outboxRestClient,
            Clock clock) {
        List<OutboxTransport> transports = new ArrayList<>();
        transports.add(new KafkaOutboxTransport(outboxKafkaTemplate, properties));
        for (OutboxTarget target : List.of(OutboxTarget.LINK, OutboxTarget.NOTI)) {
            boolean configured = properties.getEndpoints().values().stream()
                    .anyMatch(endpoint -> endpoint.getTarget() == target);
            if (configured) {
                transports.add(new HttpOutboxTransport(target, outboxRestClient, properties));
            }
        }
        return new OutboxRelayService(store, outboxRepository, properties, clock, transports);
    }

    /**
     * @param relayService relay 본체
     * @return 주기 실행 진입점
     */
    @Bean
    public OutboxRelayScheduler outboxRelayScheduler(OutboxRelayService relayService) {
        return new OutboxRelayScheduler(relayService);
    }

    /**
     * 정본 토픽 — 파티션 3, 복제 계수 1(단일 노드, A12).
     *
     * @return 토픽 정의. {@code KafkaAdmin} 이 기동 시 없으면 만든다
     */
    @Bean
    public NewTopic notificationEventsTopic() {
        return TopicBuilder.name(properties.getKafka().getTopic())
                .partitions(properties.getKafka().getPartitions())
                .replicas(properties.getKafka().getReplicationFactor())
                .build();
    }

    /**
     * 소비 실패의 종착 토픽 — <b>정본과 같은 파티션 수</b>여야 한다(계약 §3).
     *
     * <p>파티션 수가 다르면 {@code key=userId} 의 파티션 배치가 달라져 같은 유저의 DLT 재처리분이
     * 원 토픽과 다른 파티션으로 흩어진다 — 재처리 순서가 사라진다.
     *
     * @return 토픽 정의
     */
    @Bean
    public NewTopic notificationEventsDltTopic() {
        return TopicBuilder.name(properties.getKafka().getDltTopic())
                .partitions(properties.getKafka().getPartitions())
                .replicas(properties.getKafka().getReplicationFactor())
                .build();
    }
}

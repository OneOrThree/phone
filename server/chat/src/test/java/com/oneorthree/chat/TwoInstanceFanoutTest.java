package com.oneorthree.chat;

import com.oneorthree.chat.membership.client.GroupClient;
import com.oneorthree.chat.message.dto.ChatMessageResponse;
import com.oneorthree.chat.message.dto.SendMessageRequest;
import com.zaxxer.hikari.HikariDataSource;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.lang.NonNull;
import org.springframework.messaging.converter.CompositeMessageConverter;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.converter.SimpleMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import javax.sql.DataSource;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * <b>인스턴스 두 대</b>가 서로의 말을 듣는지 — 이 서비스의 스케일아웃 주장 전체가 여기 걸려 있다.
 *
 * <p>STOMP 의 기본 브로커({@code SimpleBroker})는 <b>프로세스 안의 구독자만</b> 안다. 그래서 인스턴스를
 * 두 대로 늘리는 순간 A 에 붙은 사람과 B 에 붙은 사람은 서로의 말을 못 듣는데, <b>그 고장은 인스턴스가
 * 한 대인 개발·CI 에서는 절대 재현되지 않는다.</b> 운영에서 스케일아웃한 날에야 드러난다.
 *
 * <p>다른 테스트들은 그 경로의 «절반씩»만 본다 — {@code ChatFanoutTest} 는 발행이 나가는지를(목),
 * {@code ChatWebSocketIntegrationTest} 는 남이 흘린 것을 받는지를(손으로 만든 이벤트) 본다. 둘이
 * 만나는 지점(직렬화 형식, 채널 이름, 자기 메아리 필터)은 어느 쪽도 확인하지 못한다. 여기서는
 * <b>두 번째 애플리케이션 컨텍스트를 실제로 띄워</b> 같은 Redis·같은 DB 를 보게 하고, A 로 보낸 말이
 * B 에 붙은 소켓에 도착하는지를 본다.
 *
 * <p>두 컨텍스트가 같은 저장소를 보게 하려고 컨테이너 접속 정보를 <b>빈에서 읽어</b> 두 번째 인스턴스에
 * 속성으로 넘긴다({@code @ServiceConnection} 은 속성이 아니라 빈으로 주입하기 때문에 그대로는 물려줄 수 없다).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class TwoInstanceFanoutTest {

    private static final long TIMEOUT_SECONDS = 20;

    @LocalServerPort
    private int portA;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private LettuceConnectionFactory redisConnectionFactory;

    /**
     * 두 인스턴스가 «각자» 상류를 부른다. 이쪽 목은 A 의 것이고, B 에는 아래에서 자기 목을 심는다 —
     * 그래야 B 도 구독 인가를 통과한다.
     */
    @MockitoBean
    private GroupClient groupClient;

    private ConfigurableApplicationContext instanceB;
    private int portB;
    private WebSocketStompClient stompClient;

    /** 스텁 빈이 읽어야 해서 static 이다 — 컨텍스트 B 는 이 인스턴스를 모른다. */
    private static volatile UUID sharedIsland;

    private UUID island;
    private UUID alice;
    private UUID bob;
    private String aliceBearer;
    private String bobBearer;

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        sharedIsland = island;
        alice = UUID.randomUUID();
        bob = UUID.randomUUID();
        aliceBearer = bearerOf(alice);
        bobBearer = bearerOf(bob);

        given(groupClient.fetchMyGroupIds(aliceBearer)).willReturn(Set.of(island));
        given(groupClient.fetchMyGroupIds(bobBearer)).willReturn(Set.of(island));

        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));

        instanceB = startSecondInstance();
        portB = Integer.parseInt(instanceB.getEnvironment().getRequiredProperty("local.server.port"));
    }

    @AfterEach
    void tearDown() {
        stompClient.stop();
        if (instanceB != null) {
            instanceB.close();
        }
    }

    @Test
    @DisplayName("A 에서 보낸 말이 B 에 붙은 사람에게 도착한다 — 인스턴스 한 대에선 절대 재현되지 않는 고장")
    void messageCrossesInstances() throws Exception {
        // 두 «프로세스»여야 의미가 있다. 포트가 같으면 A 와 B 가 한 인스턴스라 이 테스트는 아무것도
        // 증명하지 못한다 — 실제로 속성 우선순위 때문에 그렇게 된 적이 있어서 단언으로 못 박는다.
        assertThat(portB).isNotEqualTo(portA);

        StompSession onA = connect(portA, aliceBearer);
        StompSession onB = connect(portB, bobBearer);
        BlockingQueue<ChatMessageResponse> heardOnB = subscribe(onB, island);

        // 구독 등록과 발신 사이의 경합은 «멱등 재전송»으로 없앤다(같은 clientMessageId 라 방에 남는 말은 하나다).
        UUID clientMessageId = UUID.randomUUID();
        ChatMessageResponse received = null;
        for (int attempt = 0; attempt < 30 && received == null; attempt++) {
            onA.send("/app/groups/" + island + "/send",
                    new SendMessageRequest("건너편 인스턴스에 들리나요", clientMessageId));
            received = heardOnB.poll(500, TimeUnit.MILLISECONDS);
        }

        assertThat(received).as("frameErrors=%s", frameErrors).isNotNull();
        assertThat(received.content()).isEqualTo("건너편 인스턴스에 들리나요");
        assertThat(received.senderId()).isEqualTo(alice);
        assertThat(received.groupId()).isEqualTo(island);
        // 재전송을 몇 번 했든 저장된 말은 하나다 — 그 하나가 계속 다시 방송된 것이다.
        assertThat(received.clientMessageId()).isEqualTo(clientMessageId);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /**
     * 두 번째 인스턴스를 같은 JVM 안에 띄운다.
     *
     * <p>Testcontainers 를 다시 띄우지 않고 <b>같은 컨테이너</b>를 보게 하는 것이 핵심이다 — 그래야
     * 「같은 Redis 를 공유하는 두 프로세스」라는 운영 구도가 된다. 접속 정보는 컨텍스트 A 의 빈에서
     * 꺼낸다({@code @ServiceConnection} 이 속성을 남기지 않으므로 환경 복사로는 안 된다).
     */
    private ConfigurableApplicationContext startSecondInstance() {
        HikariDataSource hikari = (HikariDataSource) dataSource;
        return new SpringApplicationBuilder(ChatApplication.class)
                .profiles("ci")
                .sources(StubUpstream.class)
                // ⚠️ 값은 «커맨드라인 인자»로 넘긴다. SpringApplicationBuilder.properties() 는
                //    setDefaultProperties 로 들어가 «가장 낮은 우선순위»라, application.yml 의
                //    server.port: 8081 에 그대로 밀린다 — 실제로 그렇게 두 인스턴스가 같은 포트를
                //    잡으려 들었고, 결국 A 와 B 가 «같은 프로세스»가 되어 테스트가 아무것도 증명하지
                //    못했다. 커맨드라인 인자는 yml 보다 높다.
                .run("--server.port=0",
                        // 관리 포트도 옮긴다 — 안 그러면 두 인스턴스가 같은 9091 을 잡으려 든다.
                        "--management.server.port=0",
                        "--spring.datasource.url=" + hikari.getJdbcUrl(),
                        "--spring.datasource.username=" + hikari.getUsername(),
                        "--spring.datasource.password=" + hikari.getPassword(),
                        "--spring.data.redis.host=" + redisConnectionFactory.getHostName(),
                        "--spring.data.redis.port=" + redisConnectionFactory.getPort(),
                        // B 는 Flyway 를 다시 돌리지 않는다 — A 가 이미 만들었다.
                        "--spring.flyway.enabled=false");
    }

    /**
     * B 의 상류 스텁.
     *
     * <p>A 의 {@code @MockitoBean} 은 그 컨텍스트에만 있어서 B 는 자기 것을 갖고 있어야 구독 인가를
     * 통과한다. {@code registerSingleton} 으로 심으면 컴포넌트 스캔이 등록하는 진짜 빈과 «둘»이 되어
     * 어느 쪽이 주입될지 알 수 없다 — 실제로 진짜 빈이 주입돼 B 의 구독이 {@code UPSTREAM_UNAVAILABLE}
     * 로 거절됐다. {@code @Primary} 는 그 모호함을 결정적으로 없앤다.
     */
    // ⚠️ @SpringBootApplication 을 달면 안 된다. 그건 @SpringBootConfiguration 이기도 해서,
    //    @SpringBootTest 가 설정 클래스를 찾을 때 «후보가 둘»이 되어 이 패키지의 모든 통합 테스트가
    //    initializationError 로 깨진다(실제로 그렇게 6개가 한꺼번에 죽었다).
    //    @TestConfiguration 은 컴포넌트 스캔 대상이 아니라 그 사고가 구조적으로 불가능하다.
    @org.springframework.boot.test.context.TestConfiguration
    static class StubUpstream {

        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        GroupClient stubGroupClient() {
            return new GroupClient("http://localhost:1", 100) {
                @Override
                public Set<UUID> fetchMyGroupIds(String bearerToken) {
                    return Set.of(sharedIsland);
                }
            };
        }
    }

    /**
     * 두 세션에 도착한 ERROR 프레임·예외를 모은다.
     *
     * <p>진단용이 아니라 <b>실패 메시지용</b>이다. 이 테스트가 깨질 때 「도착하지 않았다」만으로는
     * 원인을 알 수 없다 — 구독이 거절된 것인지(인가), 전파가 안 된 것인지(Redis), 아니면 두
     * 인스턴스가 실은 한 프로세스인지(포트). 실제로 이 큐가 {@code UPSTREAM_UNAVAILABLE} 을 보여 줘서
     * 「B 의 상류 스텁이 진짜 빈에 밀렸다」를 찾아냈다.
     */
    private final BlockingQueue<String> frameErrors = new LinkedBlockingQueue<>();

    private StompSession connect(int port, String bearer) throws Exception {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", bearer);
        return stompClient.connectAsync("ws://localhost:" + port + "/ws/chat",
                        new WebSocketHttpHeaders(), headers, new StompSessionHandlerAdapter() {
                            @Override
                            public Type getPayloadType(StompHeaders h) {
                                return byte[].class;
                            }

                            @Override
                            public void handleFrame(StompHeaders h, Object payload) {
                                frameErrors.add("FRAME port=" + port + " msg=" + h.getFirst("message"));
                            }

                            @Override
                            public void handleException(StompSession sess, org.springframework.messaging.simp.stomp.StompCommand cmd,
                                    StompHeaders h, byte[] payload, Throwable ex) {
                                frameErrors.add("EX port=" + port + " " + ex);
                            }
                        })
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private BlockingQueue<ChatMessageResponse> subscribe(StompSession session, UUID groupId) {
        BlockingQueue<ChatMessageResponse> queue = new LinkedBlockingQueue<>();
        session.subscribe("/topic/groups/" + groupId, new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return ChatMessageResponse.class;
            }

            @Override
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                queue.add((ChatMessageResponse) payload);
            }
        });
        return queue;
    }

    private String bearerOf(UUID userId) {
        return "Bearer " + Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
    }
}

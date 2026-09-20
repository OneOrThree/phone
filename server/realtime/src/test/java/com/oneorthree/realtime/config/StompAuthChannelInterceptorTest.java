package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.fanout.ChatFanout;
import com.oneorthree.realtime.focus.IslandFocusSessions;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;

import java.util.Optional;
import java.util.Locale;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 관문의 «프레임별» 책임 — 어떤 프레임에서 무엇을 보는가.
 *
 * <p>실소켓 테스트({@code ChatWebSocketIntegrationTest})는 정상 클라이언트가 하는 일만 재현할 수 있다.
 * <b>프로토콜을 어기는 클라이언트</b>(CONNECT 없이 SUBSCRIBE·SEND 부터 보내는 경우)는 Spring 의 STOMP
 * 클라이언트로는 만들어 낼 수 없어서, 그 경로는 여기서 프레임을 손으로 만들어 확인한다.
 *
 * <p>이 사각지대가 실제로 결함을 숨기고 있었다 — SEND 에 인증 검사가 없어, CONNECT 를 건너뛴 세션의
 * SEND 가 관문이 아니라 컨트롤러의 NPE 로 떨어졌다(그물에 걸려 INTERNAL_ERROR + error 로그).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StompAuthChannelInterceptorTest {

    private static final String BEARER = "Bearer test-token";
    private static final String SESSION = "socket-1";

    @Mock
    private JwtValidator jwtValidator;

    @Mock
    private ChatAccessGuard accessGuard;

    @Mock
    private IslandFocusSessions focusSessions;

    @Mock
    private org.springframework.data.redis.core.StringRedisTemplate redis;

    @Mock
    private org.springframework.data.redis.core.ValueOperations<String, String> valueOps;

    private StompAuthChannelInterceptor interceptor;
    private RealtimeSessionRegistry registry;

    private UUID userId;
    private UUID groupId;

    @BeforeEach
    void setUp() {
        registry = new RealtimeSessionRegistry();
        interceptor = new StompAuthChannelInterceptor(jwtValidator, accessGuard, registry, focusSessions, redis);
        userId = UUID.randomUUID();
        groupId = UUID.randomUUID();
        given(redis.opsForValue()).willReturn(valueOps);
        // 구독 상한은 기본 「창을 잡았다」 — 상한 자체의 회귀는 실 Redis 를 쓰는 통합 테스트가 본다.
        given(valueOps.setIfAbsent(any(String.class), any(String.class), any(java.time.Duration.class)))
                .willReturn(true);
    }

    @Test
    @DisplayName("CONNECT — 토큰이 유효하면 세션에 주체가 묶인다")
    void connectBindsPrincipal() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor accessor = accessor(StompCommand.CONNECT);
        accessor.addNativeHeader("Authorization", BEARER);

        interceptor.preSend(message(accessor), null);

        verifyNoInteractions(accessGuard);
    }

    @Test
    @DisplayName("CONNECT — 토큰이 없으면 UNAUTHORIZED 로 거절한다")
    void connectWithoutTokenIsRejected() {
        StompHeaderAccessor accessor = accessor(StompCommand.CONNECT);

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.UNAUTHORIZED);
    }

    @Test
    @DisplayName("SUBSCRIBE — CONNECT 없이 오면 UNAUTHORIZED")
    void subscribeWithoutConnectIsRejected() {
        StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
        accessor.setDestination("/topic/groups/" + groupId);

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.UNAUTHORIZED);
        verifyNoInteractions(accessGuard);
    }

    @Test
    @DisplayName("SUBSCRIBE — 패턴 구독(/topic/groups/*)은 거절한다. 이게 뚫리면 전 섬 대화가 샌다")
    void wildcardGroupSubscriptionIsRejected() {
        // SimpleBroker 의 구독 레지스트리는 목적지를 AntPath 로 «패턴 매칭»한다. 그래서 이 목적지가
        // 통과하면 그 세션은 이후 모든 /topic/groups/<uuid> 브로드캐스트를 받는다 — 멤버십 검사를
        // 한 번도 거치지 않고. 종전 구현은 「정규식에 일치할 때만 검사」라 여기가 그냥 열려 있었다.
        for (String destination : new String[] {
                "/topic/groups/*", "/topic/groups/**", "/topic/**", "/topic/groups/",
        }) {
            StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
            accessor.setUser(new ChatPrincipal(userId, BEARER));
            accessor.setDestination(destination);

            assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                    .describedAs("목적지 %s", destination)
                    .isInstanceOf(DomainException.class);
        }
        verifyNoInteractions(accessGuard);
    }

    @Test
    @DisplayName("SUBSCRIBE — 개인 큐도 «정확히 그 문자열»일 때만 통과한다")
    void personalQueuePatternIsRejected() {
        StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
        accessor.setUser(new ChatPrincipal(userId, BEARER));
        accessor.setDestination("/user/queue/**");

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class);
    }

    @Test
    @DisplayName("SUBSCRIBE — 개인 큐는 인가 대상이 아니다(Spring 이 세션별로 이름을 가른다)")
    void personalQueueSubscriptionPasses() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
        accessor.setDestination("/user/queue/errors");
        accessor.setUser(new ChatPrincipal(userId, BEARER));

        assertThatCode(() -> interceptor.preSend(message(accessor), null)).doesNotThrowAnyException();
        verifyNoInteractions(accessGuard);
    }

    @Test
    @DisplayName("SUBSCRIBE — 재전송 되돌림 큐도 열려 있다. 막혀 있으면 재전송이 영원히 응답을 못 받는다")
    void duplicateEchoQueueSubscriptionPasses() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
        // 서버가 «보내는» 목적지와 같은 문자열이어야 한다 — 상수를 되읽어 둘이 어긋나는 순간 깨지게 한다.
        accessor.setDestination("/user" + ChatFanout.DUPLICATE_QUEUE);
        accessor.setUser(new ChatPrincipal(userId, BEARER));

        assertThatCode(() -> interceptor.preSend(message(accessor), null)).doesNotThrowAnyException();
        verify(accessGuard).requireNotFocusing(userId);
    }

    @Test
    @DisplayName("SUBSCRIBE — 개인 큐도 인증되지 않은 세션이나 만료 토큰에는 열리지 않는다")
    void personalQueuesRequireValidAuthentication() {
        for (String destination : new String[] {"/user/queue/errors", "/user" + ChatFanout.DUPLICATE_QUEUE}) {
            StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
            accessor.setDestination(destination);
            assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                    .isInstanceOf(DomainException.class)
                    .extracting(e -> ((DomainException) e).getErrorCode())
                    .isEqualTo(CommonErrorCode.UNAUTHORIZED);

            accessor.setUser(new ChatPrincipal(userId, BEARER));
            given(jwtValidator.extractUserId("test-token")).willReturn(Optional.empty());
            assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                    .isInstanceOf(DomainException.class)
                    .extracting(e -> ((DomainException) e).getErrorCode())
                    .isEqualTo(CommonErrorCode.UNAUTHORIZED);
        }
        verifyNoInteractions(accessGuard);
    }

    @Test
    @DisplayName("SUBSCRIBE — 대문자 UUID 목적지는 «거절»한다. 통과시키면 조용히 아무것도 못 받는다")
    void uppercaseUuidDestinationIsRejected() {
        StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
        // UUID.fromString 은 통과시키지만, 발행은 언제나 소문자(UUID.toString)로 간다.
        // 여기서 허용하면 구독은 되고 메시지는 영영 안 온다 — 클라이언트가 원인을 알 길이 없다.
        accessor.setDestination("/topic/groups/" + groupId.toString().toUpperCase(Locale.ROOT));

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class);
    }

    @Test
    @DisplayName("SEND — 대문자 UUID 목적지도 같은 이유로 거절한다")
    void uppercaseUuidSendDestinationIsRejected() {
        StompHeaderAccessor accessor = accessor(StompCommand.SEND);
        accessor.setUser(new ChatPrincipal(userId, BEARER));
        accessor.setDestination("/app/groups/" + groupId.toString().toUpperCase(Locale.ROOT) + "/send");

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class);
    }

    @Test
    @DisplayName("SEND — CONNECT 없이 오면 UNAUTHORIZED 다. NPE 로 떨어지면 안 된다")
    void sendWithoutConnectIsRejected() {
        StompHeaderAccessor accessor = accessor(StompCommand.SEND);
        accessor.setDestination("/app/groups/" + groupId + "/send");

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.UNAUTHORIZED);
    }

    @Test
    @DisplayName("SEND — 브로커 목적지로 직접 보내면 거절한다. 이게 뚫리면 컨트롤러를 통째로 우회한다")
    void directSendToBrokerDestinationIsRejected() {
        // /topic 은 브로커 목적지다. 목적지를 안 보면 이 프레임이 애플리케이션 목적지(/app)가 아니라
        // 브로커로 곧장 가서 그 방 구독자에게 전달된다 — 멤버십·집중·본문 검증·DB 저장을 전부 건너뛰고.
        for (String destination : new String[] {
                "/topic/groups/" + groupId, "/topic/groups/*", "/queue/anything", "/app/groups/" + groupId,
        }) {
            StompHeaderAccessor accessor = accessor(StompCommand.SEND);
            accessor.setUser(new ChatPrincipal(userId, BEARER));
            accessor.setDestination(destination);

            assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                    .describedAs("목적지 %s", destination)
                    .isInstanceOf(DomainException.class);
        }
    }

    @Test
    @DisplayName("SEND — 36자지만 UUID 가 아닌 목적지는 «관문»에서 거절한다. 안 그러면 연결이 끊긴다")
    void malformedGroupIdInSendDestination() {
        // 관문이 안 거르면 컨트롤러의 @DestinationVariable UUID 변환이 메시징 계층의
        // MethodArgumentTypeMismatchException 을 던지는데, 그 타입은 handleInvalidPayload 가 잡는
        // 둘에 없어서 ERROR 프레임 + 연결 종료로 이어진다 — 오타 하나가 세션을 죽인다.
        StompHeaderAccessor accessor = accessor(StompCommand.SEND);
        accessor.setUser(new ChatPrincipal(userId, BEARER));
        accessor.setDestination("/app/groups/" + "-".repeat(36) + "/send");

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
    }

    @Test
    @DisplayName("SEND — 인증된 세션은 통과한다. 규칙 판정은 서비스 몫이라 여기서 관문을 부르지 않는다")
    void authenticatedSendPassesWithoutDomainCheck() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor accessor = accessor(StompCommand.SEND);
        accessor.setDestination("/app/groups/" + groupId + "/send");
        accessor.setUser(new ChatPrincipal(userId, BEARER));

        assertThatCode(() -> interceptor.preSend(message(accessor), null)).doesNotThrowAnyException();
        // 두 곳에서 검사하면 언젠가 한쪽만 바뀐다 — 도메인 규칙은 ChatMessageService 한 곳이다.
        verifyNoInteractions(accessGuard);
    }

    @Test
    @DisplayName("그 밖의 프레임(DISCONNECT 등)은 그대로 흘린다")
    void otherFramesPassThrough() {
        assertThatCode(() -> interceptor.preSend(message(accessor(StompCommand.DISCONNECT)), null))
                .doesNotThrowAnyException();
        verifyNoInteractions(accessGuard, jwtValidator);
    }

    @Test
    @DisplayName("SUBSCRIBE — 36자지만 UUID 가 아닌 목적지는 INVALID_REQUEST")
    void malformedGroupIdInDestination() {
        StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
        accessor.setUser(new ChatPrincipal(userId, BEARER));
        accessor.setDestination("/topic/groups/" + "-".repeat(36));
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        verify(accessGuard, org.mockito.Mockito.never()).requireCanChat(any(), any(), any());
    }

    @Test
    @DisplayName("관전 둘(focus·rest)은 인증만으로 구독된다 — 비소속 관전 개방")
    void watchChannelsOpenToAnyAuthenticatedUser() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        for (String channel : new String[] {"focus", "rest"}) {
            StompHeaderAccessor frame = accessor(StompCommand.SUBSCRIBE);
            frame.setUser(new ChatPrincipal(userId, BEARER));
            frame.setDestination("/topic/islands/" + groupId + "/" + channel);
            assertThatCode(() -> interceptor.preSend(message(frame), null)).doesNotThrowAnyException();
        }
        // 관전은 채팅 규칙(멤버십·집중)과 무관하다 — 그쪽 가드를 부르면 집중 중인 사람이 관전을 못 한다.
        verifyNoInteractions(accessGuard);
        verifyNoInteractions(focusSessions);
    }

    @Test
    @DisplayName("emote 구독은 그 섬의 본인 진행 세션(active·paused)을 Data 정본에 묻는다 — 없으면 거절")
    void emoteSubscriptionAsksTheAuthority() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor frame = accessor(StompCommand.SUBSCRIBE);
        frame.setUser(new ChatPrincipal(userId, BEARER));
        frame.setDestination("/topic/islands/" + groupId + "/emotes");

        assertThatCode(() -> interceptor.preSend(message(frame), null)).doesNotThrowAnyException();
        // sessionId 는 null 이다 — 구독은 「진행 세션이 있기만 하면」이고 어느 세션인지는 발신이 본다.
        verify(focusSessions).requireActiveSession(groupId, userId, null);

        org.mockito.BDDMockito.willThrow(new ChatException(ChatErrorCode.NOT_FOCUSING))
                .given(focusSessions).requireActiveSession(groupId, userId, null);
        assertThatThrownBy(() -> interceptor.preSend(message(frame), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.NOT_FOCUSING);
    }

    @Test
    @DisplayName("emote SEND 는 인증만 본다 — 도메인 규칙은 서비스 한 곳이다")
    void emoteSendChecksAuthenticationOnly() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor frame = accessor(StompCommand.SEND);
        frame.setUser(new ChatPrincipal(userId, BEARER));
        frame.setDestination("/app/islands/" + groupId + "/focus/emotes");

        assertThatCode(() -> interceptor.preSend(message(frame), null)).doesNotThrowAnyException();
        verifyNoInteractions(accessGuard, focusSessions);
    }

    @Test
    @DisplayName("아직 열지 않은 섬 채널·개인 이벤트 큐·직접 브로커 SEND 는 계속 거절한다")
    void notYetOpenedDestinationsRemainClosed() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        for (String destination : new String[] {
                "/topic/islands/" + groupId + "/events",
                "/topic/islands/" + groupId + "/playback",
                "/topic/islands/" + groupId + "/messages",
                "/topic/islands/" + groupId + "/focus/",
                "/topic/islands/" + groupId + "/*",
                "/user/queue/events"}) {
            StompHeaderAccessor frame = accessor(StompCommand.SUBSCRIBE);
            frame.setUser(new ChatPrincipal(userId, BEARER));
            frame.setDestination(destination);
            assertThatThrownBy(() -> interceptor.preSend(message(frame), null)).isInstanceOf(DomainException.class);
        }
        for (String destination : new String[] {
                "/topic/islands/" + groupId + "/emotes",
                "/app/islands/" + groupId + "/focus/emotes/extra",
                "/user/queue/events"}) {
            StompHeaderAccessor frame = accessor(StompCommand.SEND);
            frame.setUser(new ChatPrincipal(userId, BEARER));
            frame.setDestination(destination);
            assertThatThrownBy(() -> interceptor.preSend(message(frame), null)).isInstanceOf(DomainException.class);
        }
    }

    @Test
    @DisplayName("대문자 UUID 로 연 섬 구독은 거절한다 — 통과시키면 구독은 되고 아무것도 못 받는다")
    void islandTopicRejectsUppercaseUuid() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor frame = accessor(StompCommand.SUBSCRIBE);
        frame.setUser(new ChatPrincipal(userId, BEARER));
        frame.setDestination("/topic/islands/" + groupId.toString().toUpperCase(Locale.ROOT) + "/focus");

        assertThatThrownBy(() -> interceptor.preSend(message(frame), null)).isInstanceOf(DomainException.class);
    }

    @Test
    @DisplayName("한 세션의 누적 구독은 상한에서 멈춘다 — 섬 UUID 를 바꿔 가며 쌓아도 막힌다")
    void subscriptionsPerSessionAreCapped() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));

        for (int i = 0; i < RealtimeSessionRegistry.MAX_SUBSCRIPTIONS_PER_SESSION; i++) {
            Message<byte[]> frame = message(islandSubscribe("s" + i, UUID.randomUUID()));
            assertThatCode(() -> interceptor.preSend(frame, null)).doesNotThrowAnyException();
        }
        assertThat(registry.subscriptionCount(SESSION))
                .isEqualTo(RealtimeSessionRegistry.MAX_SUBSCRIPTIONS_PER_SESSION);

        // 빈도 창은 «조회 수»만 막는다 — 창마다 하나씩 꾸준히 쌓는 이 경로는 누적 상한만이 막는다.
        assertThatThrownBy(() -> interceptor.preSend(message(islandSubscribe("over", UUID.randomUUID())), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
    }

    @Test
    @DisplayName("같은 목적지를 다른 id 로 다시 구독하면 거절한다 — 사건 하나가 구독 수만큼 복제된다")
    void duplicateDestinationIsRejected() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        UUID island = UUID.randomUUID();

        assertThatCode(() -> interceptor.preSend(message(islandSubscribe("first", island)), null))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> interceptor.preSend(message(islandSubscribe("second", island)), null))
                .isInstanceOf(DomainException.class);
        // 같은 id 로 같은 목적지가 다시 오는 것은 «재전송»이라 통과한다 — 늦게 온 프레임이 세션을 죽이면 안 된다.
        assertThatCode(() -> interceptor.preSend(message(islandSubscribe("first", island)), null))
                .doesNotThrowAnyException();
        assertThat(registry.subscriptionCount(SESSION)).isEqualTo(1);
    }

    @Test
    @DisplayName("UNSUBSCRIBE 가 자리를 돌려준다 — 섬을 다시 찾아온 정상 클라이언트가 막히지 않는다")
    void unsubscribeFreesTheSlot() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        UUID island = UUID.randomUUID();
        interceptor.preSend(message(islandSubscribe("sub-1", island)), null);

        StompHeaderAccessor leave = accessor(StompCommand.UNSUBSCRIBE);
        leave.setSessionId(SESSION);
        leave.setSubscriptionId("sub-1");
        interceptor.preSend(message(leave), null);

        assertThat(registry.subscriptionCount(SESSION)).isZero();
        assertThatCode(() -> interceptor.preSend(message(islandSubscribe("sub-2", island)), null))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("정상 흐름(한 섬의 focus·rest·emotes + 개인 큐)은 상한에 걸리지 않는다")
    void normalSubscriptionSetIsWellUnderTheCap() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        UUID island = UUID.randomUUID();

        for (String channel : new String[] {"focus", "rest", "emotes"}) {
            StompHeaderAccessor frame = accessor(StompCommand.SUBSCRIBE);
            frame.setUser(new ChatPrincipal(userId, BEARER));
            frame.setSessionId(SESSION);
            frame.setSubscriptionId(channel);
            frame.setDestination("/topic/islands/" + island + "/" + channel);
            assertThatCode(() -> interceptor.preSend(message(frame), null)).doesNotThrowAnyException();
        }
        StompHeaderAccessor errors = accessor(StompCommand.SUBSCRIBE);
        errors.setUser(new ChatPrincipal(userId, BEARER));
        errors.setSessionId(SESSION);
        errors.setSubscriptionId("errors");
        errors.setDestination("/user/queue/errors");
        assertThatCode(() -> interceptor.preSend(message(errors), null)).doesNotThrowAnyException();

        assertThat(registry.subscriptionCount(SESSION))
                .isLessThan(RealtimeSessionRegistry.MAX_SUBSCRIPTIONS_PER_SESSION);
    }

    private StompHeaderAccessor islandSubscribe(String subscriptionId, UUID island) {
        StompHeaderAccessor frame = accessor(StompCommand.SUBSCRIBE);
        frame.setUser(new ChatPrincipal(userId, BEARER));
        frame.setSessionId(SESSION);
        frame.setSubscriptionId(subscriptionId);
        frame.setDestination("/topic/islands/" + island + "/focus");
        return frame;
    }

    private static StompHeaderAccessor accessor(StompCommand command) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(command);
        accessor.setLeaveMutable(true);
        return accessor;
    }

    private static Message<byte[]> message(StompHeaderAccessor accessor) {
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}

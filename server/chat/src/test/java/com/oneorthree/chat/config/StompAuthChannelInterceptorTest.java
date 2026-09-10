package com.oneorthree.chat.config;

import com.oneorthree.chat.auth.ChatPrincipal;
import com.oneorthree.chat.auth.JwtValidator;
import com.oneorthree.chat.common.exception.CommonErrorCode;
import com.oneorthree.chat.common.exception.DomainException;
import com.oneorthree.chat.message.service.ChatAccessGuard;
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
import java.util.UUID;

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

    @Mock
    private JwtValidator jwtValidator;

    @Mock
    private ChatAccessGuard accessGuard;

    private StompAuthChannelInterceptor interceptor;

    private UUID userId;
    private UUID groupId;

    @BeforeEach
    void setUp() {
        interceptor = new StompAuthChannelInterceptor(jwtValidator, accessGuard);
        userId = UUID.randomUUID();
        groupId = UUID.randomUUID();
    }

    @Test
    @DisplayName("CONNECT — 토큰이 유효하면 세션에 주체가 묶인다")
    void connectBindsPrincipal() {
        given(jwtValidator.extractUserId("test-token")).willReturn(Optional.of(userId));
        StompHeaderAccessor accessor = accessor(StompCommand.CONNECT);
        accessor.addNativeHeader("Authorization", BEARER);

        interceptor.preSend(message(accessor), null);

        assertThatCode(() -> verify(accessGuard).requireNotFocusing(userId)).doesNotThrowAnyException();
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
    @DisplayName("SUBSCRIBE — 개인 큐는 인가 대상이 아니다(Spring 이 세션별로 이름을 가른다)")
    void personalQueueSubscriptionPasses() {
        StompHeaderAccessor accessor = accessor(StompCommand.SUBSCRIBE);
        accessor.setDestination("/user/queue/errors");

        assertThatCode(() -> interceptor.preSend(message(accessor), null)).doesNotThrowAnyException();
        verifyNoInteractions(accessGuard);
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
    @DisplayName("SEND — 인증된 세션은 통과한다. 규칙 판정은 서비스 몫이라 여기서 관문을 부르지 않는다")
    void authenticatedSendPassesWithoutDomainCheck() {
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

        assertThatThrownBy(() -> interceptor.preSend(message(accessor), null))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        verify(accessGuard, org.mockito.Mockito.never()).requireCanChat(any(), any(), any());
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

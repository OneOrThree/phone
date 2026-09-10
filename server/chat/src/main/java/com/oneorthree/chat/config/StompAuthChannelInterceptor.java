package com.oneorthree.chat.config;

import com.oneorthree.chat.auth.ChatPrincipal;
import com.oneorthree.chat.auth.JwtValidator;
import com.oneorthree.chat.common.exception.CommonErrorCode;
import com.oneorthree.chat.common.exception.DomainException;
import com.oneorthree.chat.message.service.ChatAccessGuard;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * STOMP 프레임 두 종류에 관문을 세운다 — CONNECT(누구인가)와 SUBSCRIBE(들어가도 되는가).
 *
 * <p>SEND 는 여기서 막지 않는다. {@code ChatMessageService.send} 가 같은
 * {@link ChatAccessGuard} 를 부르기 때문이고, 두 곳에서 검사하면 언젠가 한쪽만 바뀐다.
 *
 * <h2>왜 핸드셰이크가 아니라 CONNECT 에서 인증하는가</h2>
 * 브라우저·React Native 의 WebSocket 은 핸드셰이크에 임의 헤더를 싣지 못하는 경우가 있다. 토큰을
 * 쿼리스트링에 실으면 접근 로그·프록시 로그에 자격증명이 그대로 남는다. STOMP 는 자체 프레임에
 * 헤더를 실을 수 있으므로, 핸드셰이크는 익명으로 열고 첫 프레임에서 인증한다.
 *
 * <p>그 대가로 <b>인증 안 된 소켓이 잠시 열려 있다</b>. CONNECT 가 오기 전에는 아무 목적지도 구독할 수
 * 없고 SEND 도 처리되지 않으므로 이 창으로 새는 정보는 없다. 다만 연결 자체를 소모할 수는 있어서,
 * 유휴 연결 정리는 서버 앞단(nginx)의 타임아웃이 맡는다.
 *
 * <h2>집중 검사를 CONNECT 에도 두는 이유</h2>
 * 「집중 중엔 채팅 접속 불가」가 이 서비스의 규칙이라, 막는 지점이 구독·발신뿐이면 소켓은 열려 있는
 * 채로 아무것도 안 되는 상태가 된다. 앱 입장에서 「연결됨」과 「쓸 수 있음」이 어긋나는 것보다
 * 연결 자체를 거절하는 편이 그리기 쉽다.
 *
 * <p>단, <b>이미 연결된 세션을 집중 시작 시점에 끊지는 않는다.</b> 그러려면 Data API 의 집중 시작을
 * 채팅이 알아야 하고(이벤트) 유저별 세션 레지스트리도 필요하다. 진행 중 이탈은 앱이 구독을 해제하는
 * 쪽으로 맡긴다 — 앱이 안 끊어도 발신은 서비스가 막고, 채팅에는 푸시가 없어 구독이 살아 있어도
 * 집중을 방해하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    /**
     * 구독 인가 대상 경로. {@code ChatFanout#topicOf} 가 만드는 경로와 <b>같은 모양이어야 한다</b> —
     * 한쪽만 바꾸면 구독은 되는데 인가만 안 걸리는 상태가 된다.
     *
     * <p>UUID 를 {@code [0-9a-fA-F-]{36}} 로 느슨하게 잡고 실제 파싱은 {@code UUID.fromString} 에
     * 맡긴다. 정규식으로 UUID 를 엄밀히 표현하려 들면 길고 틀리기 쉽다.
     */
    private static final Pattern GROUP_TOPIC = Pattern.compile("^/topic/groups/([0-9a-fA-F-]{36})$");

    private final JwtValidator jwtValidator;
    private final ChatAccessGuard accessGuard;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }

        switch (accessor.getCommand()) {
            case CONNECT -> authenticate(accessor);
            case SUBSCRIBE -> authorizeSubscription(accessor);
            default -> {
                // 나머지 프레임(SEND·DISCONNECT·ACK…)은 그대로 흘린다. SEND 의 규칙 검사는 서비스가 한다.
            }
        }
        return message;
    }

    /** CONNECT — 토큰을 검증해 세션에 주체를 묶고, 집중 중이면 연결 자체를 거절한다. */
    private void authenticate(StompHeaderAccessor accessor) {
        String authorization = accessor.getFirstNativeHeader("Authorization");
        String token = (authorization != null && authorization.startsWith("Bearer "))
                ? authorization.substring(7)
                : null;

        UUID userId = jwtValidator.extractUserId(token)
                .orElseThrow(() -> new StompAuthException(CommonErrorCode.UNAUTHORIZED));

        accessGuard.requireNotFocusing(userId);
        accessor.setUser(new ChatPrincipal(userId, authorization));
    }

    /**
     * SUBSCRIBE — {@code /topic/groups/{groupId}} 만 검사한다.
     *
     * <p>그 밖의 목적지({@code /user/queue/**} 개인 큐 등)는 통과시킨다. 개인 큐는 Spring 이 세션별로
     * 이름을 갈라 주므로 남의 큐를 구독할 수 없다.
     *
     * <p><b>주체가 없으면 거절한다.</b> CONNECT 없이 SUBSCRIBE 가 올 수 있고(프로토콜 위반이지만
     * 클라이언트가 그렇게 보낼 수는 있다), 그때 null 을 그냥 흘리면 인증 없이 구독이 성립한다.
     */
    private void authorizeSubscription(StompHeaderAccessor accessor) {
        Matcher matcher = GROUP_TOPIC.matcher(String.valueOf(accessor.getDestination()));
        if (!matcher.matches()) {
            return;
        }

        if (!(accessor.getUser() instanceof ChatPrincipal principal)) {
            throw new StompAuthException(CommonErrorCode.UNAUTHORIZED);
        }

        UUID groupId;
        try {
            groupId = UUID.fromString(matcher.group(1));
        } catch (IllegalArgumentException e) {
            // 36자 모양은 맞는데 UUID 가 아니다 — 그런 섬은 없으므로 인증 실패가 아니라 인가 실패다.
            throw new StompAuthException(CommonErrorCode.INVALID_REQUEST);
        }

        accessGuard.requireCanChat(groupId, principal.userId(), principal.bearer());
    }

    /**
     * 관문이 거절할 때 던지는 예외 — {@link ChatStompErrorHandler} 가 이걸 ERROR 프레임 봉투로 바꾼다.
     *
     * <p>{@link DomainException} 을 상속해서 «도메인 거절»과 같은 취급을 받게 한다. 그래야 에러
     * 핸들러가 한 가지 타입만 알면 되고, 인증 실패와 규칙 위반이 앱에서 같은 모양으로 도착한다.
     */
    static class StompAuthException extends DomainException {
        StompAuthException(CommonErrorCode errorCode) {
            super(errorCode);
        }
    }
}

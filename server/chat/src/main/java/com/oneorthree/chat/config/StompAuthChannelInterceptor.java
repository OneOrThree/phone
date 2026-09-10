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
 * <p>SEND 의 <b>도메인 규칙</b>(같은 섬인가·집중 중인가)은 여기서 보지 않는다.
 * {@code ChatMessageService.send} 가 같은 {@link ChatAccessGuard} 를 부르기 때문이고, 두 곳에서
 * 검사하면 언젠가 한쪽만 바뀐다. <b>다만 «누구인가»는 여기서 본다</b> — 그건 컨트롤러에 도달하기
 * 전에 이미 필요한 정보라서다(아래 {@code requireAuthenticatedSend} 참고).
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
 * <h2>구독은 «구독 시점»에만 인가된다 (알려진 한계)</h2>
 * 구독이 성립한 뒤 그 사람이 섬에서 나가거나 강퇴돼도, <b>소켓을 끊기 전까지는 계속 받는다</b>.
 * 멤버십 캐시 TTL 은 여기에 도움이 되지 않는다 — 이미 통과한 구독을 다시 검사하지 않기 때문이다.
 * 발신은 매번 검사하므로 막히고, 새 구독도 막힌다. 남는 것은 «듣기»뿐이다.
 *
 * <p>고치려면 아웃바운드 채널에서 매 브로드캐스트마다 재인가하거나(구독자 수만큼 멤버십 조회가
 * 돈다) 멤버십 변경 이벤트로 해당 세션의 구독을 끊어야 한다(Data API→채팅 이벤트 배선이 필요하다).
 * 지금은 <b>탈퇴·강퇴가 드물고 그 창이 한 세션 수명</b>이라는 판단으로 수용한다.
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
            case SEND -> requireAuthenticatedSend(accessor);
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
     * SEND — <b>인증 여부만</b> 본다. 규칙 판정은 서비스가 한다.
     *
     * <p>이 검사가 없으면 CONNECT 를 건너뛰고 SEND 부터 보내는 클라이언트(프로토콜 위반이지만
     * 실제로 가능하다)에서 {@code accessor.getUser()} 가 null 이 되고, 그 null 이 컨트롤러 파라미터로
     * 그대로 주입돼 <b>{@code principal.userId()} 에서 NPE</b> 가 난다. 결과가 안전하긴 하다 —
     * 저장·브로드캐스트 전이라 새는 것은 없다. 문제는 «어떻게» 실패하느냐다:
     * <ul>
     *   <li>의도한 거절({@code UNAUTHORIZED})이 아니라 그물({@code INTERNAL_ERROR})로 떨어진다.
     *       프로토콜 위반 클라이언트 하나가 error 레벨 스택트레이스를 계속 남긴다 — 「의도된 거절은
     *       debug, 몰랐던 고장은 error」라는 이 서비스의 로그 원칙이 거기서 깨진다.</li>
     *   <li>SUBSCRIBE 는 같은 케이스를 이미 명시적으로 막고 있었다. 대칭이 아니었다.</li>
     * </ul>
     *
     * <p>여기를 통과하면 컨트롤러의 {@code ChatPrincipal} 파라미터는 <b>null 이 아님이 보장된다</b>.
     */
    private void requireAuthenticatedSend(StompHeaderAccessor accessor) {
        if (!(accessor.getUser() instanceof ChatPrincipal)) {
            throw new StompAuthException(CommonErrorCode.UNAUTHORIZED);
        }
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

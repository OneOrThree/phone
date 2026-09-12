package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.fanout.ChatFanout;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
 * STOMP 프레임에 관문을 세운다 — CONNECT·SUBSCRIBE·SEND.
 *
 * <p><b>SUBSCRIBE 는 허용 목록 방식이다</b>(허용할 목적지를 열거하고 나머지는 거절). 「그룹 토픽에
 * 일치할 때만 검사」로는 {@code /topic/groups/*} 같은 «패턴 구독»이 검사를 통째로 비켜 간다 —
 * 자세한 근거는 {@code authorizeSubscription} 에 있다.
 *
 * <p><b>SEND 도 허용 목록 방식이다.</b> {@code /topic} 은 브로커 목적지라, 목적지를 검사하지 않으면
 * 클라이언트가 {@code /topic/groups/{남의 섬}} 으로 직접 SEND 해서 <b>컨트롤러를 거치지 않고</b>
 * 그 방 구독자에게 위조 메시지를 꽂을 수 있다 — 근거는 {@code authorizeSend} 에 있다.
 *
 * <p>SEND 의 <b>도메인 규칙</b>(같은 섬인가·집중 중인가)은 여기서 보지 않는다.
 * {@code ChatMessageService.send} 가 같은 {@link ChatAccessGuard} 를 부르기 때문이고, 두 곳에서
 * 검사하면 언젠가 한쪽만 바뀐다.
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
 * <p>CONNECT는 인증만 담당한다. 집중 중에도 집중/휴식용 연결은 필요하므로,
 * 집중 차단은 채팅 SUBSCRIBE·SEND·REST 및 기존 구독의 아웃바운드 전달에 적용한다.
 * 신규 섬 목적지는 후속 도메인의 인가·복구 계약이 구현될 때까지 열지 않는다.
 */
@Slf4j
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
    /**
     * 그 섬의 브로드캐스트 토픽. <b>소문자 UUID 만</b> 받는다.
     *
     * <p>대문자를 허용하면 {@code UUID.fromString} 은 통과시키지만 <b>구독은 원문 그대로</b> 브로커에
     * 등록되는 반면 발행은 {@code ChatFanout.topicOf} 가 {@code UUID.toString()}(소문자)로 한다 —
     * 그래서 {@code /topic/groups/ABC…} 로 구독한 클라이언트는 <b>인가에 성공하고도 아무것도 못
     * 받는다.</b> 거절되면 클라이언트가 즉시 알지만, 통과시키면 «조용히» 안 된다.
     */
    private static final Pattern GROUP_TOPIC = Pattern.compile("^/topic/groups/([0-9a-f-]{36})$");

    /**
     * 발신 실패 통지를 받는 개인 큐. <b>정확히 이 문자열만</b> 허용한다 —
     * {@code startsWith("/user/")} 같은 접두 매칭으로 열어 두면 그 접두 아래로 패턴 구독이 다시 들어온다.
     */
    private static final String PERSONAL_ERROR_QUEUE = "/user/queue/errors";

    /**
     * 재전송 되돌림을 받는 개인 큐 — {@code ChatFanout#DUPLICATE_QUEUE} 와 <b>같은 목적지</b>여야 한다.
     * 여기에 없으면 서버는 보내는데 클라이언트는 구독조차 못 해, 재전송이 영원히 응답을 못 받는다.
     */
    private static final String PERSONAL_DUPLICATE_QUEUE = "/user" + ChatFanout.DUPLICATE_QUEUE;

    /**
     * 유일하게 허용하는 발신 목적지. {@code ChatStompController} 의 {@code @MessageMapping} 과
     * <b>같은 모양이어야 한다</b> — 매핑을 늘리면 여기도 늘려야 하고, 그게 강제되는 것이 이 방식의 값어치다.
     */
    private static final Pattern SEND_DESTINATION =
            Pattern.compile("^/app/groups/([0-9a-f-]{36})/send$");

    private final JwtValidator jwtValidator;
    private final ChatAccessGuard accessGuard;
    private final RealtimeSessionRegistry sessions;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }

        switch (accessor.getCommand()) {
            case CONNECT -> authenticate(accessor);
            case SUBSCRIBE -> authorizeSubscription(accessor);
            case SEND -> authorizeSend(accessor);
            default -> {
                // 나머지 프레임(SEND·DISCONNECT·ACK…)은 그대로 흘린다. SEND 의 규칙 검사는 서비스가 한다.
            }
        }
        return message;
    }

    /** CONNECT — 토큰을 검증해 세션에 주체를 묶는다. 집중 판정은 채팅 목적지에서 한다. */
    private void authenticate(StompHeaderAccessor accessor) {
        String authorization = accessor.getFirstNativeHeader("Authorization");
        String token = (authorization != null && authorization.startsWith("Bearer "))
                ? authorization.substring(7)
                : null;

        UUID userId = jwtValidator.extractUserId(token)
                .orElseThrow(() -> new StompAuthException(CommonErrorCode.UNAUTHORIZED));

        ChatPrincipal principal = new ChatPrincipal(userId, authorization);
        accessor.setUser(principal);
        sessions.register(accessor.getSessionId(), principal);
    }

    /**
     * SUBSCRIBE — <b>허용 목록에 없는 목적지는 전부 거절한다.</b>
     *
     * <h3>왜 「그룹 토픽만 검사」가 아니라 「나머지 전부 거절」인가</h3>
     * 종전에는 {@code /topic/groups/{uuid}} «에 일치할 때만» 검사하고 나머지는 흘렸다. 그건
     * <b>인가 우회</b>였다 — {@code /topic/groups/*} 나 {@code /topic/groups/**} 는 그 정규식에
     * 걸리지 않아 검사 없이 통과하는데, Spring 의 {@code SimpleBroker} 구독 레지스트리는 목적지를
     * <b>AntPath 패턴으로 매칭</b>하므로 그 구독은 이후 <b>모든 섬의 브로드캐스트를 받는다</b>.
     * 인증만 하면 누구나 전 섬의 대화를 실시간으로 볼 수 있었다는 뜻이다.
     *
     * <p>패턴 문자를 «금지»하는 방식(와일드카드 문자 거르기)으로는 못 막는다 — 막아야 할 것을
     * 빠짐없이 열거해야 하고, 그 목록은 브로커의 매칭 규칙이 바뀌면 조용히 낡는다. 반대로
     * <b>허용할 모양을 열거</b>하면 새 목적지를 추가할 때 «여기도 고쳐야 한다»가 강제된다.
     *
     * <h3>허용하는 둘</h3>
     * <ul>
     *   <li>{@code /topic/groups/{uuid}} — 정확히 이 모양일 때만. 그다음 멤버십·집중을 본다</li>
     *   <li>{@code /user/queue/errors} — 발신 실패 통지. Spring 이 세션별로 이름을 갈라 라우팅하므로
     *       남의 큐를 구독할 수 없다(그래서 인가 대상이 아니다)</li>
     * </ul>
     */
    private void authorizeSubscription(StompHeaderAccessor accessor) {
        String destination = String.valueOf(accessor.getDestination());

        if (PERSONAL_ERROR_QUEUE.equals(destination) || PERSONAL_DUPLICATE_QUEUE.equals(destination)) {
            ChatPrincipal principal = requireAuthenticated(accessor);
            if (PERSONAL_DUPLICATE_QUEUE.equals(destination)) {
                accessGuard.requireNotFocusing(principal.userId());
            }
            return;
        }

        Matcher matcher = GROUP_TOPIC.matcher(destination);
        if (!matcher.matches()) {
            // 알 수 없는 목적지 — 패턴 구독(/topic/groups/*)이 여기로 떨어진다.
            log.debug("허용되지 않은 구독 목적지 — {}", destination);
            throw new StompAuthException(CommonErrorCode.INVALID_REQUEST);
        }

        ChatPrincipal principal = requireAuthenticated(accessor);

        UUID groupId;
        try {
            groupId = UUID.fromString(matcher.group(1));
        } catch (IllegalArgumentException e) {
            // 36자 모양은 맞는데 UUID 가 아니다 — 그런 섬은 없다.
            throw new StompAuthException(CommonErrorCode.INVALID_REQUEST);
        }

        accessGuard.requireCanChat(groupId, principal.userId(), principal.bearer());
    }

    /**
     * SEND — <b>목적지를 허용 목록으로 좁히고</b>, 인증 여부를 본다.
     *
     * <h3>목적지를 안 보면 규칙 전체가 우회된다</h3>
     * {@code /topic} 은 브로커 목적지다({@code enableSimpleBroker}). 그래서 클라이언트가
     * <b>{@code /topic/groups/{남의 섬}} 으로 직접 SEND</b> 하면 그 프레임은 애플리케이션 목적지
     * ({@code /app})가 아니라 <b>브로커로 곧장 가서 그 방 구독자 전원에게 전달된다</b> —
     * {@code ChatMessageService.send} 를 거치지 않으므로 멤버십·집중·본문 검증·DB 저장이 통째로
     * 건너뛰어진다. 인증만 통과하면 <b>아무 섬에나 위조 메시지를 꽂을 수 있었다.</b>
     *
     * <p>구독 쪽과 같은 이유로 «허용을 열거»한다 — 지금 허용하는 건 {@code /app/groups/{uuid}/send}
     * 하나뿐이다. {@code @MessageMapping} 이 하나 더 생기면 여기도 같이 늘려야 하고, 그게 강제되는
     * 것이 이 방식의 값어치다.
     *
     * <h3>인증은 여기서, 도메인 규칙은 서비스에서</h3>
     * 이 검사가 없으면 CONNECT 를 건너뛴 세션의 {@code accessor.getUser()} 가 null 이 되고, 그 null 이
     * 컨트롤러 파라미터로 주입돼 <b>{@code principal.userId()} 에서 NPE</b> 가 난다 — 의도한 거절
     * ({@code UNAUTHORIZED}) 대신 그물({@code INTERNAL_ERROR})로 떨어져, 프로토콜 위반 클라이언트
     * 하나가 error 레벨 스택트레이스를 계속 남긴다.
     *
     * <p>「같은 섬인가·집중 중인가」는 여기서 보지 않는다 — 그건 {@code ChatMessageService.send} 한
     * 곳이고, 두 곳에서 검사하면 언젠가 한쪽만 바뀐다.
     */
    private void authorizeSend(StompHeaderAccessor accessor) {
        String destination = String.valueOf(accessor.getDestination());
        Matcher matcher = SEND_DESTINATION.matcher(destination);
        if (!matcher.matches()) {
            // 브로커 목적지(/topic/**·/queue/**)로의 직접 발신이 여기로 떨어진다.
            log.debug("허용되지 않은 발신 목적지 — {}", destination);
            throw new StompAuthException(CommonErrorCode.INVALID_REQUEST);
        }

        // 36자 모양만 맞고 UUID 가 아닌 목적지를 «여기서» 거른다. 안 거르면 컨트롤러의
        // @DestinationVariable UUID 변환이 메시징 계층의 MethodArgumentTypeMismatchException 을 던지는데,
        // 그 타입은 handleInvalidPayload 가 잡는 둘에 없어서 ERROR 프레임 + «연결 종료»로 이어진다 —
        // 오타 하나가 세션을 죽인다. SUBSCRIBE 와 같은 자리에서 같은 방식으로 막는다.
        try {
            UUID.fromString(matcher.group(1));
        } catch (IllegalArgumentException e) {
            throw new StompAuthException(CommonErrorCode.INVALID_REQUEST);
        }

        requireAuthenticated(accessor);
    }

    /** 사용자별 멤버십 캐시와 무관하게, 이 세션의 토큰이 지금도 유효한지 확인한다. */
    private ChatPrincipal requireAuthenticated(StompHeaderAccessor accessor) {
        if (!(accessor.getUser() instanceof ChatPrincipal principal)) {
            throw new StompAuthException(CommonErrorCode.UNAUTHORIZED);
        }
        String bearer = principal.bearer();
        String token = bearer != null && bearer.startsWith("Bearer ") ? bearer.substring(7) : null;
        // 다른 기기가 캐시를 갱신해도 만료된 소켓의 인증 수명이 연장되면 안 된다.
        jwtValidator.extractUserId(token)
                .filter(principal.userId()::equals)
                .orElseThrow(() -> new StompAuthException(CommonErrorCode.UNAUTHORIZED));
        return principal;
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

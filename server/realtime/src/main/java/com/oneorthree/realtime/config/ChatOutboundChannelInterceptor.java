package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.event.RealtimeEventDelivery;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;
import java.util.regex.Matcher;

import static com.oneorthree.realtime.config.StompTopics.EMOTES_CHANNEL;
import static com.oneorthree.realtime.config.StompTopics.GROUP_TOPIC;
import static com.oneorthree.realtime.config.StompTopics.ISLAND_TOPIC;

/**
 * 구독 후 집중 시작·토큰 만료에도 채팅 본문을 전달하지 않는다.
 * executor 큐에 넣는 preSend가 아니라 실제 소켓 handler 직전의 beforeHandle에서 검사한다.
 *
 * <h2>섬 채널 셋의 전달 직전 재검사 (GROMO-1765)</h2>
 * <b>셋 모두 먼저 세션 인증을 다시 본다.</b> 섬 채널은 오래 열려 있는 구독이라 SUBSCRIBE 때 유효하던
 * access token 이 그 뒤 만료된다 — 채널이 「공개 관전」이라고 인증까지 면제하면 <b>만료된 세션이 계속
 * 이벤트를 받고 소켓도 안 닫힌다</b>(realtime-events LLD §8 「idle 만료 후 egress 0」과 CLAUDE.md
 * 「만료된 access token」을 깬다). 관전이 공개라는 말은 «소속을 안 본다»이지 «아무나 받는다»가 아니다.
 * <ul>
 *   <li>{@code focus}·{@code rest} — 인증만 다시 본다. 비소속 관전을 열었으므로(2026-09-19) 그 위에
 *       잃을 «소속 자격»은 없다 — 상류 조회를 얹으면 비용만 든다.</li>
 *   <li>{@code emotes} — 그 사건의 <b>수신 대상 목록</b>과 대조한다
 *       ({@link RealtimeEventDelivery#mayReceive}). 목록은 발신 때 Data 정본에서 나온 「그 섬에서 지금
 *       진행 중인 주민」이고, 기록이 없거나 만료됐으면 <b>fail-closed</b> 로 버린다.</li>
 * </ul>
 *
 * <h2>프레즌스 사본을 최종 인가 증거로 쓰지 않는다</h2>
 * 종전에는 {@code presence:focus:*} 존재 여부로 판정했다. <b>틀린 판정이었다</b> — Data 의 리스
 * 쓰기·삭제는 <b>best-effort</b> 라(CLAUDE.md 「Contracts with Data API」 2번) 양쪽으로 다 어긋난다:
 * 쓰기가 실패하면 정상 참가자의 응원이 <b>전부 버려지고</b>, 삭제가 유실되면 종료한 사용자가
 * <b>TTL 13시간 내내 계속 받는다</b>. 그래서 focus-rest-session LLD §6 이 「이 사본을 신규 emote 의
 * 최종 인가 증거로 <b>단독 사용하지 않는다</b>」고 못 박아 뒀다.
 *
 * <p>대신 <b>사건마다 정본에서 나온 수신 집합</b>을 쓴다. 그 집합은 발신이 이미 치른 조회 한 번에서
 * 공짜로 나오므로(realtime-events LLD §4.2 「배치 권한조회」) 구독자 수 × HTTP 를 치르지 않고도
 * 판정이 정본에 붙는다. 집합은 서버 안에만 있고 프레임으로 나가지 않는다.
 *
 * <p>ponytail: 남는 창 하나 — 발신과 전달 사이(밀리초)에 종료한 사람은 그 한 건을 받는다. 이미
 * 브로커로 넘어간 프레임을 회수하지 않는다는 LLD §4.2 의 경계와 같은 자리다.
 *
 * <h2>받는 사람 기준 차단 (GROMO-2182)</h2>
 * 채팅({@code /topic/groups/{id}})과 응원({@code /topic/islands/{id}/emotes})은 섬 공용 토픽이라 브로커가
 * 구독자 전원에게 같은 프레임을 복제한다. 그래서 차단은 발신 쪽이 아니라 <b>여기, 세션별 전달 직전</b>에
 * 건다 — 받는 세션의 주체가 그 프레임의 발신자(채팅 {@code senderId}, 응원 {@code payload.userId})를
 * 차단했으면 그 세션에만 보내지 않는다. 판정·세대는 {@link BlockedUsers} 에 있다.
 *
 * <p><b>판정을 못 내리면 보내지 않는다(fail-closed, 2026-10-01 결정).</b> 차단 조회 실패·timeout·계약 위반뿐
 * 아니라 프레임에서 발신자를 읽지 못한 경우도 «전달 근거 없음»이다. 발신자가 JSON {@code null} 인 채팅
 * (탈퇴 발신자, GROMO-1946)만은 거를 대상이 없으므로 그대로 보낸다.
 */
@Slf4j
@Component
public class ChatOutboundChannelInterceptor implements ExecutorChannelInterceptor {

    private final RealtimeSessionRegistry sessions;
    private final JwtValidator jwtValidator;
    private final ChatAccessGuard accessGuard;
    private final RealtimeEventDelivery delivery;
    private final ObjectMapper objectMapper;
    private final BlockedUsers blockedUsers;

    /**
     * {@code delivery} 를 <b>늦게</b> 받는다 — 순환 때문이다. 이 인터셉터는
     * {@code WebSocketConfig} 가 만드는 아웃바운드 채널에 등록되고, {@link RealtimeEventDelivery} 는
     * 그 설정이 만드는 {@code SimpMessagingTemplate} 을 필요로 한다. 같은 이유로 그 설정도
     * {@code clientOutboundChannel} 을 {@code @Lazy} 로 받는다.
     */
    public ChatOutboundChannelInterceptor(RealtimeSessionRegistry sessions, JwtValidator jwtValidator,
            ChatAccessGuard accessGuard, @Lazy RealtimeEventDelivery delivery, ObjectMapper objectMapper,
            BlockedUsers blockedUsers) {
        this.sessions = sessions;
        this.jwtValidator = jwtValidator;
        this.accessGuard = accessGuard;
        this.delivery = delivery;
        this.objectMapper = objectMapper;
        this.blockedUsers = blockedUsers;
    }

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        if (SimpMessageHeaderAccessor.getMessageType(message.getHeaders()) != SimpMessageType.MESSAGE) {
            return message;
        }
        String destination = SimpMessageHeaderAccessor.getDestination(message.getHeaders());
        if (destination == null) {
            return null;
        }
        // 개인 이벤트 큐는 event 별 owner/방장 권한 재검사가 구현될 때까지 계속 닫아 둔다.
        if (destination.startsWith("/queue/events") || destination.equals("/user/queue/events")) {
            return null;
        }
        Matcher island = ISLAND_TOPIC.matcher(destination);
        if (island.matches()) {
            return deliverIslandEvent(message, island.group(2));
        }
        // 열거한 셋 밖의 섬 목적지(events·playback·messages)는 여전히 닫혀 있다.
        if (destination.startsWith("/topic/islands/")) {
            return null;
        }
        Matcher group = GROUP_TOPIC.matcher(destination);
        boolean groupMessage = group.matches();
        boolean duplicate = destination.startsWith("/queue/duplicates")
                || destination.equals("/user/queue/duplicates");
        if (!groupMessage && !duplicate) {
            return message; // 개인 오류 큐는 집중 거절을 알릴 수 있어야 한다.
        }
        String sessionId = SimpMessageHeaderAccessor.getSessionId(message.getHeaders());
        ChatPrincipal principal = stillAuthenticated(message);
        if (principal == null) {
            return null;
        }
        String bearer = principal.bearer();
        try {
            if (groupMessage) {
                accessGuard.requireCanChat(UUID.fromString(group.group(1)), principal.userId(), bearer);
                UUID sender = senderOf(readPayload(message), "senderId", null, true);
                if (blockedUsers.hasBlocked(principal.userId(), sender)) {
                    log.debug("채팅 전달 차단 — 받는 사람이 발신자를 차단했다");
                    return null;
                }
            } else {
                accessGuard.requireNotFocusing(principal.userId());
            }
            return message;
        } catch (UpstreamRejectedCredentialException e) {
            // 자격 자체가 무효다 — 현재 인가 조회를 기다리는 사이 AT 가 만료됐거나, sid/gen 이 없거나, Data 가 401 을 줬다.
            // 프레임만 버리면 수신 전용 앱은 다음 메시지가 올 때까지 만료를 모른 채 갱신·재연결을 시작하지 못한다.
            // 위 JWT 재검증과 같은 규칙으로 실제 소켓을 1008/UNAUTHORIZED 로 닫는다(CLAUDE.md 「만료된 access token」).
            sessions.closeUnauthorized(sessionId);
            return null;
        } catch (RuntimeException e) {
            // 일시 장애(UpstreamUnavailable)·비멤버·집중 중은 프레임만 막고 소켓은 유지한다 — 자격은 여전히 유효하다.
            // 조회 장애도 통과시키지 않는다. 본문·토큰·원격 응답은 기록하지 않는다.
            log.debug("채팅 전달 차단 — reason={}", e.getClass().getSimpleName());
            return null;
        }
    }

    /**
     * 섬 채널의 전달 직전 판정 — <b>셋 모두 인증을 다시 보고</b>, 응원만 「아직 집중 중인가」를 더 본다.
     */
    private Message<?> deliverIslandEvent(Message<?> message, String channel) {
        ChatPrincipal principal = stillAuthenticated(message);
        if (principal == null) {
            return null;
        }
        if (!EMOTES_CHANNEL.equals(channel)) {
            return message;
        }
        JsonNode root = readPayload(message);
        UUID eventId = root == null ? null : uuidAt(root.get("eventId"));
        if (eventId == null || !delivery.mayReceive(eventId, principal.userId())) {
            log.debug("응원 전달 차단 — 수신 대상이 아니다");
            return null;
        }
        try {
            if (blockedUsers.hasBlocked(principal.userId(), senderOf(root, "payload", "userId", false))) {
                log.debug("응원 전달 차단 — 받는 사람이 발신자를 차단했다");
                return null;
            }
        } catch (RuntimeException e) {
            // 차단 판정 불가 — 전달 근거가 없다. 소켓은 유지한다(자격은 여전히 유효하다).
            log.debug("응원 전달 차단 — 차단 판정 불가. reason={}", e.getClass().getSimpleName());
            return null;
        }
        return message;
    }

    /**
     * 나가는 프레임의 본문 JSON — 응원 {@code eventId}·발신자, 채팅 {@code senderId} 를 여기서 읽는다.
     *
     * <p>브로커를 지난 payload 는 이미 직렬화된 JSON 이라 여기서 다시 읽는다. <b>본문은 로그에 남기지 않는다.</b>
     *
     * @return 파싱한 루트, 실패하면 {@code null}
     */
    private JsonNode readPayload(Message<?> message) {
        try {
            Object payload = message.getPayload();
            return payload instanceof byte[] bytes ? objectMapper.readTree(bytes)
                    : objectMapper.readTree(String.valueOf(payload));
        } catch (RuntimeException e) {
            log.debug("프레임 본문 식별 실패 — reason={}", e.getClass().getSimpleName());
            return null;
        }
    }

    /**
     * 프레임의 발신자 — 채팅은 {@code senderId}, 응원은 {@code payload.userId}.
     *
     * @param nullable JSON {@code null} 을 «발신자 없음»으로 받아들일지. 채팅은 탈퇴 발신자(GROMO-1946)가
     *                 {@code null} 이라 true, 응원은 발신자가 늘 있어야 하므로 false
     * @return 발신자, 또는 허용된 {@code null}
     * @throws IllegalStateException 본문·필드가 없거나 UUID 가 아닐 때 — 차단 판정의 근거가 없으므로 전달하지 않는다
     */
    private static UUID senderOf(JsonNode root, String field, String nested, boolean nullable) {
        JsonNode node = root == null ? null : root.get(field);
        if (node != null && nested != null) {
            node = node.isObject() ? node.get(nested) : null;
        }
        if (node == null) {
            throw new IllegalStateException("발신자 필드가 없다");
        }
        if (node.isNull() && nullable) {
            return null;
        }
        UUID sender = uuidAt(node);
        if (sender == null) {
            throw new IllegalStateException("발신자 형식 오류");
        }
        return sender;
    }

    private static UUID uuidAt(JsonNode node) {
        if (node == null || !node.isString()) {
            return null;
        }
        try {
            return UUID.fromString(node.stringValue());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * 이 세션의 주체와 <b>그 토큰이 지금도 유효한지</b>. 만료면 프레임을 버리고 <b>소켓도 닫는다</b>.
     *
     * <p>프레임만 버리면 수신 전용 앱은 다음 이벤트가 올 때까지 만료를 모른 채 갱신·재연결을 시작하지
     * 못한다 — 그래서 실제 소켓을 1008/UNAUTHORIZED 로 닫는다(CLAUDE.md 「만료된 access token」).
     * 채팅 경로와 섬 경로가 <b>같은 한 곳</b>을 쓴다: 두 벌로 두면 언젠가 한쪽만 바뀐다.
     *
     * @return 지금도 유효한 주체, 아니면 {@code null}
     */
    private ChatPrincipal stillAuthenticated(Message<?> message) {
        String sessionId = SimpMessageHeaderAccessor.getSessionId(message.getHeaders());
        ChatPrincipal principal = sessions.find(sessionId);
        if (principal == null) {
            return null;
        }
        String bearer = principal.bearer();
        String token = bearer != null && bearer.startsWith("Bearer ") ? bearer.substring(7) : null;
        // 다른 기기가 캐시를 갱신해도 만료된 소켓의 인증 수명이 연장되면 안 된다.
        if (jwtValidator.extractUserId(token).filter(principal.userId()::equals).isEmpty()) {
            sessions.closeUnauthorized(sessionId);
            return null;
        }
        return principal;
    }
}

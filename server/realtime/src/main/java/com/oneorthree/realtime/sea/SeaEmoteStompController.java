package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.event.FocusEmoteType;
import com.oneorthree.realtime.focus.dto.FocusEmoteRequest;
import com.oneorthree.realtime.message.dto.SendFailureResponse;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.converter.MessageConversionException;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Duration;
import java.util.UUID;

/**
 * 바다 방 이모트 발신 입구 — {@code /app/sea/rooms/{roomId}/emotes} (GROMO-2300, 계약 §5).
 *
 * <p>{@code FocusEmoteStompController} 와 같은 규율이다: 성공하면 아무것도 돌려주지 않고(방 토픽의
 * {@code sea.emote} 가 곧 응답) 실패만 개인 오류 큐로 간다. 본문은 {@code {type}} 이고 기존
 * {@link FocusEmoteRequest} 를 재사용한다(여기서 {@code sessionId} 는 읽지 않는다).
 *
 * <p>판정 순서: 방 소속 → 5종 → 성공 창(3초). 시도 창(600ms)은 인바운드 관문이 이미 소모했다. 성공 창은 통과한
 * 요청만 쓴다 — 잘못된 type 이 정상 이모트의 창을 먹지 않게.
 *
 * <p>{@code @MessageExceptionHandler} 가 클래스 단위라 {@code SeaStompController} 와 따로 둔다.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class SeaEmoteStompController {

    static final Duration SUCCESS_WINDOW = Duration.ofSeconds(3);
    static final String EMOTE = "sea.emote";

    private final SeaRooms seaRooms;
    private final SeaRoomPublisher publisher;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    @MessageMapping("/sea/rooms/{roomId}/emotes")
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse emote(@DestinationVariable UUID roomId, @Payload @Valid FocusEmoteRequest request,
            ChatPrincipal principal) {
        UUID userId = principal.userId();
        if (!seaRooms.isMember(userId, roomId)) {
            throw new ChatException(ChatErrorCode.NOT_IN_SEA_ROOM);
        }
        FocusEmoteType type = FocusEmoteType.of(request.type())
                .orElseThrow(() -> new ChatException(ChatErrorCode.INVALID_EMOTE_TYPE));
        // SET NX EX 한 명령 — 세다가 EXPIRE 전에 끊겨 수명 없는 카운터가 남는 일이 없다.
        if (!Boolean.TRUE.equals(redis.opsForValue()
                .setIfAbsent(RedisKeys.seaEmoteRateLimit(roomId, userId), "1", SUCCESS_WINDOW))) {
            throw new ChatException(ChatErrorCode.EMOTE_TOO_FREQUENT);
        }
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("userId", userId.toString());
        payload.put("type", type.wireName());
        publisher.publish(roomId, EMOTE, payload);
        return null;
    }

    /** 도메인 거절 — 연결을 끊지 않고 개인 오류 큐로. */
    @MessageExceptionHandler(DomainException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleDomain(DomainException e) {
        log.debug("바다 이모트 거절 — code={}", e.getErrorCode().name());
        return SendFailureResponse.of(e.getErrorCode(), null);
    }

    /** 본문 형식 오류({@code type} 누락·깨진 JSON) — 메서드에 들어가기 전에 터지므로 따로 받는다. */
    @MessageExceptionHandler({MethodArgumentNotValidException.class, MessageConversionException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleInvalidPayload(Exception e) {
        log.debug("바다 이모트 본문 오류 — {}", e.getClass().getSimpleName());
        return SendFailureResponse.of(CommonErrorCode.INVALID_REQUEST, null);
    }

    /** Redis 실패 — 판정 불가로 알린다. 이 핸들러가 없으면 ERROR 프레임 + 연결 종료로 떨어진다. */
    @MessageExceptionHandler(DataAccessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleRedis(DataAccessException e) {
        log.warn("바다 이모트 Redis 실패 — reason={}", e.getClass().getSimpleName());
        return SendFailureResponse.of(CommonErrorCode.UPSTREAM_UNAVAILABLE, null);
    }
}

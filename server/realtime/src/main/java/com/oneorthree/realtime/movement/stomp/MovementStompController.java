package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.message.dto.SendFailureResponse;
import com.oneorthree.realtime.movement.MovementRooms;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.converter.MessageConversionException;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;

import java.util.UUID;

/**
 * 이동 intent 입구 — {@code /app/islands/{islandId}/movement/intent} (GROMO-2247).
 *
 * <p><b>방 큐에 넣기만 하고 바로 돌아온다.</b> 판정(STALE·범위·도달 불가)과 응답(PathAccepted·MoveRejected)은 틱
 * 스레드가 한다 — 응답은 이 메서드의 반환값이 아니라 {@code /topic/islands/{id}/movement} 로 나간다. 인증과
 * 「그 섬 movement 구독 중」은 관문이 이미 봤다. 구독 없이 레이스로 들어온 intent 는 방에 actor 가 없어 무시된다.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class MovementStompController {

    private final MovementRooms rooms;

    /**
     * @param principal CONNECT 때 세션에 묶인 주체 — 토큰 버킷이 사용자 기준이라 userId 를 같이 넘긴다(policy §3)
     * @param sessionId 이 프레임의 STOMP 세션 — 방 안의 actor 는 세션으로 찾는다
     */
    @MessageMapping("/islands/{islandId}/movement/intent")
    public void intent(@DestinationVariable UUID islandId, @Payload @Valid MoveIntentRequest request,
            ChatPrincipal principal, @Header(SimpMessageHeaderAccessor.SESSION_ID_HEADER) String sessionId) {
        rooms.accept(islandId, principal.userId(), sessionId, request.toIntent());
    }

    /**
     * 본문 형식 오류(필드 누락·깨진 JSON) — 개인 큐로 거절하고 <b>연결은 유지한다</b>.
     *
     * <p>{@code @MessageExceptionHandler} 는 그 컨트롤러 클래스에만 적용돼 {@code ChatStompController}·
     * {@code FocusEmoteStompController} 의 같은 핸들러가 대신해 주지 않는다. 없으면 변환·{@code @Valid} 예외가
     * 에러 핸들러로 올라가 ERROR 프레임 + 소켓 종료가 된다.
     */
    @MessageExceptionHandler({MethodArgumentNotValidException.class, MessageConversionException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleInvalidPayload(Exception e) {
        log.debug("이동 intent 본문 오류 — {}", e.getClass().getSimpleName());
        return SendFailureResponse.of(CommonErrorCode.INVALID_REQUEST, null);
    }

    /** 그물 — 도메인 거절이 올라오면 연결 종료 대신 개인 큐로 떨어뜨린다. */
    @MessageExceptionHandler(DomainException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleDomain(DomainException e) {
        log.debug("이동 intent 거절 — code={}", e.getErrorCode().name());
        return SendFailureResponse.of(e.getErrorCode(), null);
    }
}

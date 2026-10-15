package com.oneorthree.realtime.focus;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.focus.dto.FocusEmoteRequest;
import com.oneorthree.realtime.message.dto.SendFailureResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.converter.MessageConversionException;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;

import java.util.UUID;

/**
 * 응원 발신 입구 — {@code /app/islands/{islandId}/focus/emotes} (GROMO-1765).
 *
 * <p>{@code ChatStompController} 와 같은 규율이다: <b>성공하면 아무것도 돌려주지 않고</b>
 * ({@code /topic/islands/{islandId}/emotes} 브로드캐스트가 곧 응답이다) 실패만 개인 큐로 간다.
 * 여기에 {@code clientMessageId} 가 없는 이유는 응원이 멱등 대상이 아니기 때문이다 — 같은 SEND 를
 * 두 번 보내면 <b>별도의 응원 두 건</b>이다(LLD §2 「자동 재전송하지 않는다」).
 *
 * <p>거절 사유는 {@code ChatErrorCode} 세 가지로 갈린다 — {@code INVALID_EMOTE_TYPE}(422 의미),
 * {@code NOT_FOCUSING}(409 의미), {@code EMOTE_TOO_FREQUENT}(429 의미). LLD §2 가 요구한 구분이고,
 * HTTP 응답이 아니라 <b>봉투의 code</b> 로 전달된다.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class FocusEmoteStompController {

    private final FocusEmoteService focusEmoteService;

    /**
     * @param principal CONNECT 때 세션에 묶인 주체. null 이 아님은 {@code StompAuthChannelInterceptor}
     *                  의 SEND 관문이 보장한다
     */
    @MessageMapping("/islands/{islandId}/focus/emotes")
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse emote(@DestinationVariable UUID islandId,
            @Payload @Valid FocusEmoteRequest request, ChatPrincipal principal) {
        try {
            focusEmoteService.publish(islandId, principal.userId(), request);
            return null;
        } catch (DomainException e) {
            log.debug("응원 거절 — code={}", e.getErrorCode().name());
            return SendFailureResponse.of(e.getErrorCode(), null);
        }
    }

    /**
     * 본문이 형식을 어겼을 때({@code sessionId}·{@code type} 누락, 깨진 JSON) — <b>연결을 끊지 않는다</b>.
     *
     * <p>이 핸들러가 없으면 그 예외들은 {@link #emote} 의 {@code try/catch} 에 <b>닿지도 못한다</b> —
     * 변환·{@code @Valid} 는 메서드에 들어가기 «전»에 터지기 때문이다. 그러면 예외가 컨트롤러 밖으로
     * 나가 {@code ChatStompErrorHandler} 가 받고, 그건 ERROR 프레임을 보낸 뒤 <b>소켓을 닫는다</b>:
     * 앱이 필드 하나를 빠뜨린 것만으로 세션이 죽고 재연결·재구독을 처음부터 해야 한다.
     *
     * <p><b>{@code ChatStompController} 의 같은 핸들러가 대신해 주지 않는다.</b>
     * {@code @MessageExceptionHandler} 는 <b>그 컨트롤러 클래스에만</b> 적용된다(웹 MVC 의
     * {@code @ControllerAdvice} 같은 전역 배선이 메시징 계층엔 없다). 그래서 {@code @MessageMapping} 을
     * 가진 클래스마다 자기 핸들러가 필요하고, 그게 이 두 메서드가 저쪽과 «같은 모양으로» 중복되는 이유다.
     *
     * <p>메시징 계층의 검증 예외는 웹 MVC 의 그것과 <b>이름은 같고 패키지가 다르다</b>
     * ({@code …messaging.handler.annotation.support}). 웹 쪽 타입으로 잡으면 컴파일은 되고 매칭만
     * 조용히 안 된다.
     */
    @MessageExceptionHandler({MethodArgumentNotValidException.class, MessageConversionException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleInvalidPayload(Exception e) {
        log.debug("응원 본문 오류 — {}", e.getClass().getSimpleName());
        return SendFailureResponse.of(CommonErrorCode.INVALID_REQUEST, null);
    }

    /**
     * 그물 — {@link #emote} 밖에서 올라온 도메인 거절. 정상 흐름에서는 오지 않지만, 이 클래스에
     * {@code @MessageMapping} 이 하나 더 생겼을 때 <b>ERROR 프레임 + 연결 종료</b> 대신 개인 큐
     * 거절로 떨어지게 한다.
     */
    @MessageExceptionHandler(DomainException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleDomain(DomainException e) {
        log.debug("응원 거절 — code={}", e.getErrorCode().name());
        return SendFailureResponse.of(e.getErrorCode(), null);
    }
}

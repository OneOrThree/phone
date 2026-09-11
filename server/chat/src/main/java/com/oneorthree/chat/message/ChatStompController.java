package com.oneorthree.chat.message;

import com.oneorthree.chat.auth.ChatPrincipal;
import com.oneorthree.chat.common.exception.CommonErrorCode;
import com.oneorthree.chat.common.exception.DomainException;
import com.oneorthree.chat.message.dto.SendFailureResponse;
import com.oneorthree.chat.message.dto.SendMessageRequest;
import com.oneorthree.chat.message.service.ChatMessageService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.converter.MessageConversionException;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;

import java.util.UUID;

/**
 * 실시간 발신 입구 — {@code /app/groups/{groupId}/send}.
 *
 * <p><b>성공했을 때는 아무것도 돌려주지 않는다.</b> 성공한 메시지는 그 방의 브로드캐스트
 * ({@code /topic/groups/{groupId}})로 발신자에게도 돌아가므로, 여기서 또 돌려주면 같은 말이 두 경로로
 * 두 번 도착한다. 앱은 낙관적으로 그려 둔 말풍선을 브로드캐스트로 온 {@code clientMessageId} 로
 * 알아보고 갈아 끼운다.
 *
 * <p>실패만 개인 큐({@code /user/queue/errors})로 간다 — 실패는 브로드캐스트로 알 길이 없기 때문이다.
 * 그 통지에는 {@code clientMessageId} 가 실린다({@link SendFailureResponse}).
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class ChatStompController {

    private final ChatMessageService chatMessageService;

    /**
     * 말 한 마디를 보낸다.
     *
     * <h3>왜 예외 핸들러가 아니라 여기서 잡는가</h3>
     * 거절 통지에 {@code clientMessageId} 를 실으려면 «어느 요청이 거절됐는지»를 알아야 하는데,
     * {@code @MessageExceptionHandler} 는 예외만 받고 원래 요청 객체는 받지 못한다. 그래서 이 메서드가
     * 직접 잡아 봉투를 만든다. 성공 경로는 {@code null} 을 돌려주고, Spring 은 null 반환에는 아무것도
     * 보내지 않는다 — 그래서 «성공은 조용하고 실패만 개인 큐로» 가 한 메서드로 표현된다.
     *
     * <p>{@code broadcast = false} 가 중요하다. 기본값(true)이면 <b>같은 유저의 다른 기기 세션까지</b>
     * 이 실패를 받는다 — 폰에서 거절된 발신이 태블릿에도 실패로 뜨고, 그 기기는 보낸 적도 없는
     * 말풍선을 실패 처리하려 든다.
     *
     * @param principal CONNECT 때 세션에 묶인 주체. <b>본문에서 발신자를 받지 않는다</b> —
     *                  받는 순간 남의 이름으로 보내는 요청이 형식상 정상이 된다.
     *                  null 이 아님은 {@code StompAuthChannelInterceptor} 의 SEND 관문이 보장한다
     *                  (그 검사를 지우면 CONNECT 없이 온 SEND 가 여기서 NPE 로 떨어진다)
     * @param sessionId 이 프레임이 들어온 STOMP 세션. 재전송 되돌림을 <b>그 세션에만</b> 보내기
     *                  위해 서비스로 넘긴다 — 없으면 같은 사람의 다른 기기도 받아 같은 메시지를
     *                  두 번 처리한다({@code ChatFanout#deliverToSender})
     * @return 실패 통지, 또는 성공이면 {@code null}(아무것도 보내지 않는다)
     */
    @MessageMapping("/groups/{groupId}/send")
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse send(@DestinationVariable UUID groupId,
            @Payload @Valid SendMessageRequest request,
            ChatPrincipal principal,
            @Header(SimpMessageHeaderAccessor.SESSION_ID_HEADER) String sessionId) {
        try {
            chatMessageService.send(groupId, principal.userId(), request, principal.bearer(), sessionId);
            return null;
        } catch (DomainException e) {
            log.debug("발신 거절 — code={}", e.getErrorCode().name());
            return SendFailureResponse.of(e.getErrorCode(), request.clientMessageId());
        }
    }

    /**
     * 본문이 형식을 어겼을 때({@code clientMessageId} 누락 등) — <b>연결을 끊지 않는다</b>.
     *
     * <p>이 핸들러가 없으면 검증 예외가 컨트롤러 밖으로 나가 {@code ChatStompErrorHandler} 가 받고,
     * 그건 ERROR 프레임을 보낸 뒤 <b>소켓을 닫는다</b>. 즉 클라이언트의 사소한 실수 한 번이 세션을
     * 죽이고, 앱은 재연결·재구독을 처음부터 해야 한다. 잘못 보낸 한 건만 거절하는 게 맞다.
     *
     * <p>여기서는 {@code clientMessageId} 를 실을 수 없다 — 본문을 읽지 못해 생긴 실패라 서버도
     * 어느 요청인지 특정할 수 없다.
     *
     * <p>메시징 계층의 검증 예외는 웹 MVC 의 그것과 <b>이름은 같고 패키지가 다르다</b>
     * ({@code …messaging.handler.annotation.support}). 웹 쪽 타입으로 잡으면 컴파일은 되고 매칭만
     * 조용히 안 된다.
     */
    @MessageExceptionHandler({MethodArgumentNotValidException.class, MessageConversionException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleInvalidPayload(Exception e) {
        log.debug("발신 본문 오류 — {}", e.getClass().getSimpleName());
        return SendFailureResponse.of(CommonErrorCode.INVALID_REQUEST, null);
    }

    /**
     * 그물 — 컨트롤러 밖에서 올라온 도메인 거절.
     *
     * <p>{@link #send} 가 이미 잡으므로 정상 흐름에서는 여기 오지 않는다. 남겨 두는 이유는 앞으로
     * {@code @MessageMapping} 이 하나 더 생겼을 때 그쪽이 잡지 않아도 <b>ERROR 프레임 + 연결 종료</b>
     * 대신 개인 큐 거절로 떨어지게 하기 위해서다.
     */
    @MessageExceptionHandler(DomainException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleDomain(DomainException e) {
        log.debug("거절 — code={}", e.getErrorCode().name());
        return SendFailureResponse.of(e.getErrorCode(), null);
    }
}

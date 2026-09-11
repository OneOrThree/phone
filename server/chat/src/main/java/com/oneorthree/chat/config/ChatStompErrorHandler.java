package com.oneorthree.chat.config;

import com.oneorthree.chat.common.exception.CommonErrorCode;
import com.oneorthree.chat.common.exception.DomainException;
import com.oneorthree.chat.common.exception.ErrorCode;
import com.oneorthree.chat.common.exception.ErrorResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.util.MimeTypeUtils;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.StompSubProtocolErrorHandler;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;

/**
 * CONNECT·SUBSCRIBE 관문이 거절했을 때 나가는 ERROR 프레임을 REST 와 <b>같은 봉투</b>로 맞춘다.
 *
 * <p>이게 없으면 STOMP 거절은 예외 메시지 문자열이 그대로 실린 ERROR 프레임이 된다 — 앱이 분기할
 * 기계용 코드가 없고, 문구를 파싱하는 코드가 생기며, 무엇보다 <b>내부 예외 문자열이 클라이언트로
 * 나간다</b>.
 *
 * <p>코드는 본문 JSON 과 {@code message} 헤더 양쪽에 싣는다. 헤더에도 두는 건 STOMP 클라이언트
 * 라이브러리마다 ERROR 프레임의 본문을 노출하지 않는 것이 있어서다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatStompErrorHandler extends StompSubProtocolErrorHandler {

    /** 원인 사슬 순회 상한 — 순환하는 예외에서 무한 루프를 막는다. */
    private static final int MAX_CAUSE_DEPTH = 16;

    private final ObjectMapper objectMapper;

    @Override
    public Message<byte[]> handleClientMessageProcessingError(Message<byte[]> clientMessage, Throwable ex) {
        ErrorCode errorCode = resolve(ex);
        if (errorCode == null) {
            // 우리가 만든 거절이 아니다 — 원인을 남기고 기본 처리에 맡긴다(내부 문자열을 우리가 굳이
            // 봉투에 담아 내보내지 않는다).
            log.error("STOMP 처리 중 예상치 못한 예외", ex);
            errorCode = CommonErrorCode.INTERNAL_ERROR;
        }

        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.ERROR);
        // message 헤더 = 기계용 코드. 본문을 못 읽는 클라이언트도 이것만으로 분기할 수 있다.
        accessor.setMessage(errorCode.name());
        accessor.setContentType(MimeTypeUtils.APPLICATION_JSON);
        accessor.setLeaveMutable(true);

        return MessageBuilder.createMessage(body(errorCode), accessor.getMessageHeaders());
    }

    /**
     * 원인 사슬을 훑어 우리가 던진 거절을 찾는다.
     *
     * <p>사슬을 훑는 이유: 메시징 계층이 인터셉터의 예외를 {@code MessageDeliveryException} 으로
     * 한 겹 감싸서 올린다. 최상위 타입만 보면 우리 거절이 전부 «예상치 못한 예외»로 떨어진다.
     */
    private ErrorCode resolve(Throwable ex) {
        // 깊이에 상한을 둔다. 자기 자신을 cause 로 갖는 예외뿐 아니라 A→B→A 같은 «순환»도 실제로
        // 나오는데(재시도 래퍼가 원인을 다시 감싸는 경우), 그때 상한이 없으면 이 메서드가 영영 돌면서
        // 메시지 채널 스레드를 하나 잡아먹는다. 우리 거절은 래핑이 한두 겹이라 이 깊이면 충분하다.
        Throwable cause = ex;
        for (int depth = 0; cause != null && depth < MAX_CAUSE_DEPTH; depth++) {
            if (cause instanceof DomainException domainException) {
                return domainException.getErrorCode();
            }
            Throwable next = cause.getCause();
            if (next == cause) {
                break;
            }
            cause = next;
        }
        return null;
    }

    private byte[] body(ErrorCode errorCode) {
        try {
            return objectMapper.writeValueAsBytes(ErrorResponse.from(errorCode));
        } catch (RuntimeException e) {
            // 상수만으로 만드는 객체라 사실상 불가능하다. 그래도 프레임은 나가야 하므로 최소 형태로 접는다.
            log.error("ERROR 프레임 직렬화 실패", e);
            return ("{\"code\":\"" + errorCode.name() + "\"}").getBytes(StandardCharsets.UTF_8);
        }
    }
}

package com.oneorthree.chat.message;

import com.oneorthree.chat.auth.ChatPrincipal;
import com.oneorthree.chat.common.exception.DomainException;
import com.oneorthree.chat.common.exception.ErrorResponse;
import com.oneorthree.chat.message.dto.SendMessageRequest;
import com.oneorthree.chat.message.service.ChatMessageService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;

import java.util.UUID;

/**
 * 실시간 발신 입구 — {@code /app/groups/{groupId}/send}.
 *
 * <p><b>발신자에게 아무것도 돌려주지 않는다(void).</b> 성공한 메시지는 그 방의 브로드캐스트
 * ({@code /topic/groups/{groupId}})로 발신자에게도 돌아가므로, 여기서 또 돌려주면 같은 말이 두 경로로
 * 두 번 도착한다. 앱은 낙관적으로 그려 둔 말풍선을 브로드캐스트로 온
 * {@code clientMessageId} 로 알아보고 갈아 끼운다.
 *
 * <p>실패만 개인 큐({@code /user/queue/errors})로 간다 — 실패는 브로드캐스트로 알 길이 없기 때문이다.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class ChatStompController {

    private final ChatMessageService chatMessageService;

    /**
     * @param principal CONNECT 때 세션에 묶인 주체. <b>본문에서 발신자를 받지 않는다</b> —
     *                  받는 순간 남의 이름으로 보내는 요청이 형식상 정상이 된다
     */
    @MessageMapping("/groups/{groupId}/send")
    public void send(@DestinationVariable UUID groupId,
            @Payload @Valid SendMessageRequest request,
            ChatPrincipal principal) {
        chatMessageService.send(groupId, principal.userId(), request, principal.bearer());
    }

    /**
     * 발신 실패를 보낸 사람에게만 알린다.
     *
     * <p>{@code @SendToUser} 는 세션별로 큐 이름을 갈라 주므로 남의 실패가 섞이지 않는다. 봉투는
     * REST 와 같은 {@code {code, message}} 다 — 앱의 분기가 한 벌로 끝나야 한다.
     *
     * <p>여기서 잡는 건 «우리가 의도한 거절»뿐이다. 그 밖의 예외는
     * {@code ChatStompErrorHandler} 가 ERROR 프레임으로 처리한다(그쪽은 연결을 끊는다).
     */
    @MessageExceptionHandler(DomainException.class)
    @SendToUser("/queue/errors")
    public ErrorResponse handleDomain(DomainException e) {
        log.debug("발신 거절 — code={}", e.getErrorCode().name());
        return ErrorResponse.from(e.getErrorCode());
    }
}

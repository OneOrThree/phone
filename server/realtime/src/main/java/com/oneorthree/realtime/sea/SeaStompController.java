package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.message.dto.SendFailureResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;

/**
 * 먼바다 입장·퇴장 입구 (GROMO-2300). 본문은 {@code {}} 이고 읽지 않는다.
 *
 * <p>프레임 순서: {@code SUB /user/queue/sea → SEND enter → assigned{roomId} → SUB /topic/sea/rooms/{roomId}
 * → SEND sync → snapshot{roomId, members}}. 구독 뒤에 스냅샷을 받으니 그 사이 사건을 놓치지 않는다.
 *
 * <p>입장 결과({@code sea.room.assigned})는 <b>보낸 세션 한 곳</b>의 {@code /user/queue/sea} 로 간다 — 같은 사람의
 * 다른 기기가 남의 세션 응답을 받지 않게({@code broadcast = false}). 거절은 {@code /user/queue/errors} 로 가고
 * 연결은 유지한다. 인증·시도 창은 {@code StompAuthChannelInterceptor} 가 이미 봤다.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class SeaStompController {

    private final SeaRooms seaRooms;

    /** @return 배정 결과. 세션이 이미 끊겼으면 {@code null}(보내지 않는다) */
    @MessageMapping("/sea/enter")
    @SendToUser(destinations = "/queue/sea", broadcast = false)
    public SeaRoomEvent enter(ChatPrincipal principal,
            @Header(SimpMessageHeaderAccessor.SESSION_ID_HEADER) String sessionId) {
        return seaRooms.enter(principal.userId(), sessionId);
    }

    /**
     * 방 스냅샷 — 방 토픽을 구독한 «뒤»에 보낸다. 그 세션 한 곳에만 간다. 방이 없으면 {@code NOT_IN_SEA_ROOM} 을
     * 개인 오류 큐로.
     */
    @MessageMapping("/sea/sync")
    @SendToUser(destinations = "/queue/sea", broadcast = false)
    public SeaRoomEvent sync(ChatPrincipal principal) {
        return seaRooms.snapshot(principal.userId());
    }

    @MessageMapping("/sea/leave")
    public void leave(ChatPrincipal principal) {
        seaRooms.leaveCurrent(principal.userId(), SeaRooms.LEFT);
    }

    /** 도메인 거절(상류 실패 {@code UPSTREAM_UNAVAILABLE} 등) — 연결을 끊지 않고 개인 오류 큐로. */
    @MessageExceptionHandler(DomainException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleDomain(DomainException e) {
        log.debug("바다 입장·퇴장 거절 — code={}", e.getErrorCode().name());
        return SendFailureResponse.of(e.getErrorCode(), null);
    }

    /** Redis 실패 — 판정 불가로 알린다. 이 핸들러가 없으면 ERROR 프레임 + 연결 종료로 떨어진다. */
    @MessageExceptionHandler(DataAccessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public SendFailureResponse handleRedis(DataAccessException e) {
        log.warn("바다 입장·퇴장 Redis 실패 — reason={}", e.getClass().getSimpleName());
        return SendFailureResponse.of(CommonErrorCode.UPSTREAM_UNAVAILABLE, null);
    }
}

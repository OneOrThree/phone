package com.oneorthree.realtime.message;

import com.oneorthree.realtime.auth.LoginUser;
import com.oneorthree.realtime.message.dto.ChatHistoryResponse;
import com.oneorthree.realtime.message.dto.ChatRoomResponse;
import com.oneorthree.realtime.message.dto.MarkReadRequest;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.service.ChatMessageService;
import com.oneorthree.realtime.message.service.ChatRoomService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 소켓 밖에서 필요한 것 셋 — 방 목록, 지난 말, 읽음 표시.
 *
 * <p>실시간 경로가 STOMP 인데 REST 가 따로 있는 이유는 <b>채팅에 푸시가 없기 때문</b>이다. 앱을 열
 * 때마다 소켓을 붙여 놓고 기다릴 수는 없으니, 「어디에 몇 개 쌓였나」는 평범한 HTTP 로 묻는다.
 *
 * <p>경로가 {@code /api/v1/chat/rooms/{groupId}} 인데 groupId 가 곧 방 id 다 — 섬 하나에 방 하나라
 * 별도의 방 식별자를 만들지 않았다. 나중에 섬 안에 방이 여럿 생기면 여기에 한 단계가 붙는다.
 */
@RestController
@RequestMapping("/api/v1/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatRoomService chatRoomService;
    private final ChatMessageService chatMessageService;

    /**
     * 내 섬들의 채팅 현황.
     *
     * <p>집중 중이면 {@code FOCUS_IN_PROGRESS}(409) — 목록조차 보여 주지 않는다. 「채팅 접속 자체가
     * 안 된다」가 규칙이라, 배지만 보이면 그게 곧 들어가고 싶은 유혹이 된다.
     */
    @GetMapping("/rooms")
    public ResponseEntity<List<ChatRoomResponse>> myRooms(
            @LoginUser UUID userId,
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
        return ResponseEntity.ok(chatRoomService.myRooms(userId, authorization));
    }

    /**
     * 지난 말 한 페이지 — 최신부터 과거로.
     *
     * @param cursor 이 메시지보다 과거를 달라. 첫 페이지면 생략한다. 응답의 {@code nextCursor} 를
     *               그대로 다시 넣으면 다음 페이지다
     * @param size 생략하면 {@value ChatMessageService#DEFAULT_PAGE_SIZE},
     *             {@value ChatMessageService#MAX_PAGE_SIZE} 로 잘린다
     */
    @GetMapping("/rooms/{groupId}/messages")
    public ResponseEntity<ChatHistoryResponse> history(
            @PathVariable UUID groupId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size,
            @LoginUser UUID userId,
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
        return ResponseEntity.ok(
                chatMessageService.history(groupId, userId, parseCursor(cursor), size, authorization));
    }

    /**
     * 「여기까지 읽었다」.
     *
     * <p>이미 더 읽은 상태에서 옛 위치가 와도 204 다 — 커서가 안 움직였을 뿐 요청은 정상이다.
     */
    @PostMapping("/rooms/{groupId}/read")
    public ResponseEntity<Void> markRead(
            @PathVariable UUID groupId,
            @Valid @RequestBody MarkReadRequest request,
            @LoginUser UUID userId,
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
        chatRoomService.markRead(groupId, userId, request.lastReadMessageId(), authorization);
        return ResponseEntity.noContent().build();
    }

    /**
     * 커서 파싱 — 못 읽으면 «처음부터»로 떨어뜨리지 않고 거절한다.
     *
     * <p>조용히 첫 페이지로 접으면 무한 스크롤이 맨 위에서 같은 페이지를 영원히 다시 받는다.
     * 400 으로 세우면 그 버그가 즉시 드러난다.
     */
    private UUID parseCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(cursor);
        } catch (IllegalArgumentException e) {
            throw new ChatException(ChatErrorCode.INVALID_CURSOR);
        }
    }
}

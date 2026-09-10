package com.oneorthree.chat.message.service;

import com.oneorthree.chat.fanout.ChatFanout;
import com.oneorthree.chat.message.dto.ChatHistoryResponse;
import com.oneorthree.chat.message.dto.ChatMessageResponse;
import com.oneorthree.chat.message.dto.SendMessageRequest;
import com.oneorthree.chat.message.exception.ChatErrorCode;
import com.oneorthree.chat.message.exception.ChatException;
import com.oneorthree.chat.message.repository.ChatMessageRepository;
import com.oneorthree.chat.message.repository.domain.ChatMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 말하기와 지난 말 읽기.
 *
 * <p>두 입구 모두 {@link ChatAccessGuard} 를 먼저 통과한다 — 규칙 검사를 컨트롤러에 두지 않은 이유는
 * 입구가 STOMP 와 REST 둘이라, 한쪽에만 두면 다른 쪽이 뚫리기 때문이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatMessageService {

    /**
     * 본문 길이 상한. DB 컬럼({@code varchar(2000)})도 같은 값이지만 <b>거절은 여기서</b> 한다 —
     * DB 까지 가면 400 이 아니라 500 이 된다.
     *
     * <p>두 상한의 «단위»가 다르다는 점이 안전한 방향으로 작용한다: 자바 {@code length()} 는 UTF-16
     * 단위이고 Postgres 의 varchar 길이는 문자 수라, 이모지처럼 대리쌍을 쓰는 문자는 자바가 2, DB 가
     * 1 로 센다. 즉 <b>여기를 통과한 문자열이 컬럼을 넘칠 수는 없다</b>(반대로 이모지만 있는 긴 글은
     * 실제 문자 수가 상한에 못 미쳐도 거절될 수 있는데, 그건 수용한다).
     */
    public static final int MAX_CONTENT_LENGTH = 2000;

    /** 히스토리 한 페이지 기본 크기. */
    public static final int DEFAULT_PAGE_SIZE = 30;

    /** 한 번에 가져갈 수 있는 최대치. 이 상한이 없으면 {@code size=100000} 한 방으로 메모리를 태울 수 있다. */
    public static final int MAX_PAGE_SIZE = 100;

    private final ChatMessageRepository chatMessageRepository;
    private final ChatAccessGuard accessGuard;
    private final ChatFanout chatFanout;
    private final Clock clock;

    /**
     * 섬에 말 한 마디를 남기고 그 방 사람들에게 민다.
     *
     * <p><b>이 메서드에 {@code @Transactional} 이 없는 것은 의도다.</b> 저장은 한 문장이라 트랜잭션을
     * 넓힐 이유가 없고, 오히려 넓히면 재전송 복구가 불가능해진다 — 유니크 제약에 걸리는 순간 그
     * 트랜잭션은 롤백 표시가 되어 <b>같은 트랜잭션 안에서는 다시 읽을 수도 없다</b>. 저장을 자기
     * 트랜잭션(리포지토리 기본)으로 끝내야 그다음 조회가 새 트랜잭션에서 성사된다.
     *
     * <p>브로드캐스트는 저장이 커밋된 <b>뒤</b>다. 순서를 뒤집으면 소켓으로는 왔는데 히스토리에는
     * 없는 말이 생긴다.
     *
     * <p><b>브로드캐스트는 「처음 저장됐을 때」 한 번뿐이다.</b> 재전송은 저장을 늘리지 않으므로
     * 방송도 늘리지 않는다 — 늘리면 같은 {@code messageId} 가 방 사람들에게 두 번 도착해 대화가
     * 겹쳐 보인다. 발신자는 재전송의 «응답»으로 처음 저장된 그 메시지를 받으므로 낙관적 말풍선을
     * 갈아 끼우는 데는 지장이 없다.
     *
     * <p>대신 재전송은 <b>보낸 사람에게만</b> 원본을 되돌린다({@code /user/queue/duplicates}).
     * STOMP 발신은 성공 시 아무것도 돌려주지 않고 브로드캐스트가 곧 응답이라, 이 되돌림이 없으면
     * 재전송한 클라이언트는 영영 응답을 못 받아 <b>무한히 다시 보낸다</b>.
     *
     * <p>대가는 있다 — 처음 발신의 방송이 유실됐다면(팬아웃 실패는 삼켜진다) 재전송이 그걸
     * 방 사람들에게 되살려 주지는 않는다. 그 경우의 복구는 <b>정본을 다시 읽는 쪽</b>이다:
     * 메시지는 커밋돼 있어 히스토리 조회에 나온다. 「모두에게 매번 중복 도착」보다 「드물게 한 번
     * 밀림」이 낫다고 봤다.
     *
     * @param groupId 목적지 섬
     * @param senderId 보낸 사람 = 인증된 요청자. 본문에서 오지 않는다
     * @param request 본문과 멱등 키
     * @param bearerToken 멤버십 캐시 미스 시 상류 조회에 쓸 {@code Authorization} 헤더
     * @return 저장된 메시지. <b>재전송이면 처음 저장된 그 메시지</b>가 그대로 돌아온다
     * @throws ChatException 집중 중 · 비멤버 · 빈 본문 · 길이 초과
     */
    public ChatMessageResponse send(UUID groupId, UUID senderId, SendMessageRequest request, String bearerToken) {
        accessGuard.requireCanChat(groupId, senderId, bearerToken);

        String content = normalizeContent(request.content());

        Stored stored = insertOrFindExisting(groupId, senderId, request.clientMessageId(), content);
        if (stored.freshlyInserted()) {
            chatFanout.broadcast(stored.message());
        } else {
            // 방송은 하지 않되 «보낸 사람»은 알아야 한다 — 안 그러면 무한히 다시 보낸다.
            chatFanout.deliverToSender(senderId, stored.message());
        }
        return stored.message();
    }

    /**
     * 저장 결과 — <b>그 말이 이번에 처음 저장됐는가</b>까지 같이 돌려준다.
     *
     * <p>메시지만 돌려주면 재전송인지 알 수 없어 방송을 한 번으로 묶을 수 없다.
     */
    private record Stored(ChatMessageResponse message, boolean freshlyInserted) {
    }

    /**
     * 넣어 보고, 이미 있으면 그걸 돌려준다.
     *
     * <p>「있나 보고 없으면 넣는다」의 반대 순서다. 검사를 먼저 하면 검사와 INSERT 사이에 창이 생겨
     * 동시 재전송 두 건이 둘 다 통과한다. 유니크 제약이 그 창을 없애 주므로, 제약에 걸린 뒤에 찾는
     * 쪽이 안전하다.
     *
     * <p>제약 위반이 났는데 찾지도 못하는 경우는 «다른 이유의» 무결성 위반이다(예: 컬럼 길이).
     * 그건 우리가 예상한 재전송이 아니므로 원래 예외를 그대로 올려 500 으로 드러낸다 — 조용히
     * 삼키면 메시지가 사라지는데 아무도 모른다.
     */
    private Stored insertOrFindExisting(UUID groupId, UUID senderId, UUID clientMessageId,
            String content) {
        try {
            ChatMessage saved = chatMessageRepository.save(ChatMessage.builder()
                    .groupId(groupId)
                    .senderId(senderId)
                    .content(content)
                    .clientMessageId(clientMessageId)
                    .sentAt(clock.instant())
                    .build());
            return new Stored(ChatMessageResponse.from(saved), true);
        } catch (DataIntegrityViolationException e) {
            return chatMessageRepository
                    .findByGroupIdAndSenderIdAndClientMessageId(groupId, senderId, clientMessageId)
                    .map(existing -> new Stored(ChatMessageResponse.from(existing), false))
                    .orElseThrow(() -> e);
        }
    }

    /**
     * 지난 말 한 페이지 — 최신부터 과거로.
     *
     * @param cursor 이 id 보다 «과거»를 가져온다. 첫 페이지면 null
     * @param size 요청 크기. null 이면 {@value #DEFAULT_PAGE_SIZE}, {@value #MAX_PAGE_SIZE} 로 잘린다
     */
    public ChatHistoryResponse history(UUID groupId, UUID userId, UUID cursor, Integer size, String bearerToken) {
        accessGuard.requireCanChat(groupId, userId, bearerToken);

        int limit = clampSize(size);

        // 한 건 더 받아 «더 있는가»를 판정한다. count 쿼리를 따로 치는 것보다 싸고, 두 쿼리 사이에
        // 새 메시지가 끼어들어 개수와 목록이 안 맞는 일도 없다.
        PageRequest page = PageRequest.of(0, limit + 1);
        List<ChatMessage> rows = cursor == null
                ? chatMessageRepository.findByGroupIdOrderByIdDesc(groupId, page)
                : chatMessageRepository.findByGroupIdAndIdLessThanOrderByIdDesc(groupId, cursor, page);

        boolean hasMore = rows.size() > limit;
        List<ChatMessage> pageRows = hasMore ? rows.subList(0, limit) : rows;

        List<ChatMessageResponse> messages = new ArrayList<>(pageRows.size());
        for (ChatMessage row : pageRows) {
            messages.add(ChatMessageResponse.from(row));
        }

        // 다음 커서는 이 페이지의 «가장 오래된» 것 = 내림차순 목록의 마지막.
        UUID nextCursor = hasMore ? messages.get(messages.size() - 1).messageId() : null;
        return new ChatHistoryResponse(messages, nextCursor, hasMore);
    }

    /**
     * 본문 다듬기 — 양끝 공백을 떼고 규칙을 건다.
     *
     * <p>공백을 떼고 «나서» 비었는지 본다. 순서가 반대면 공백만 있는 말이 통과해 방에 빈 말풍선이
     * 남는다. 길이 검사도 뗀 뒤의 길이로 한다.
     */
    private String normalizeContent(String raw) {
        if (raw == null) {
            throw new ChatException(ChatErrorCode.BLANK_CONTENT);
        }
        String content = raw.strip();
        if (content.isEmpty()) {
            throw new ChatException(ChatErrorCode.BLANK_CONTENT);
        }
        if (content.length() > MAX_CONTENT_LENGTH) {
            throw new ChatException(ChatErrorCode.CONTENT_TOO_LONG);
        }
        return content;
    }

    /** 0 이하·null 은 기본값으로, 상한 초과는 상한으로. 거절하지 않고 자르는 건 페이징이 UI 편의라서다. */
    private int clampSize(Integer size) {
        if (size == null || size <= 0) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(size, MAX_PAGE_SIZE);
    }
}

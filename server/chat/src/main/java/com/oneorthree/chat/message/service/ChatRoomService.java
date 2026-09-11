package com.oneorthree.chat.message.service;

import com.oneorthree.chat.common.id.UuidV7;
import com.oneorthree.chat.membership.MembershipService;
import com.oneorthree.chat.message.dto.ChatMessageResponse;
import com.oneorthree.chat.message.dto.ChatRoomResponse;
import com.oneorthree.chat.message.repository.ChatMessageRepository;
import com.oneorthree.chat.message.exception.ChatErrorCode;
import com.oneorthree.chat.message.exception.ChatException;
import com.oneorthree.chat.message.repository.ChatReadCursorRepository;
import com.oneorthree.chat.message.repository.domain.ChatMessage;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 방 목록과 읽음 표시 — <b>채팅에 푸시가 없다</b>는 결정을 떠받치는 절반.
 *
 * <p>알림을 안 보내므로 「뭔가 왔다」는 사실은 이 목록에서만 드러난다. 집중이 끝난 사람이 가장 먼저
 * 보는 화면이기도 하다.
 */
@Service
@RequiredArgsConstructor
public class ChatRoomService {

    private final ChatMessageRepository chatMessageRepository;
    private final ChatReadCursorRepository chatReadCursorRepository;
    private final MembershipService membershipService;
    private final ChatAccessGuard accessGuard;
    private final Clock clock;

    /**
     * 내가 속한 섬 전부와, 각 섬에 쌓인 안 읽은 개수.
     *
     * <p>메시지가 한 번도 없는 섬도 <b>빠뜨리지 않고</b> 넣는다 — 목록의 모수는 「내가 속한 섬」이지
     * 「대화가 있는 섬」이 아니다. 방이 안 보이면 사용자는 채팅이 고장 났다고 읽는다.
     *
     * <p>쿼리는 그룹 수와 무관하게 3회다(멤버십 1 + 마지막 메시지 1 + 안 읽음 1). 방마다 도는 모양으로
     * 바꾸면 섬이 늘수록 선형으로 느려진다.
     *
     * <p><b>트랜잭션을 열지 않는다.</b> 관문과 멤버십 조회가 Redis·서버 간 HTTP 를 타는데, 그걸
     * 트랜잭션 안에 넣으면 <b>DB 커넥션을 쥔 채 네트워크를 기다린다</b> — 상류가 느려지는 순간
     * 커넥션 풀이 마르고, 그러면 채팅과 무관한 조회까지 같이 멈춘다. 두 집계 쿼리를 한 스냅샷으로
     * 묶을 이유도 없다(화면 목록이라 약간의 어긋남이 무해하다).
     *
     * @return 마지막 말이 최근인 섬부터. 아직 아무 말도 없는 섬은 맨 뒤로 밀린다
     */
    public List<ChatRoomResponse> myRooms(UUID userId, String bearerToken) {
        accessGuard.requireNotFocusing(userId);

        Set<UUID> groupIds = membershipService.myGroupIds(userId, bearerToken);
        if (groupIds.isEmpty()) {
            // IN () 은 SQL 문법 오류다 — 빈 목록을 그대로 넘기지 않고 여기서 끊는다.
            return List.of();
        }

        Map<UUID, ChatMessage> latestByGroup = chatMessageRepository.findLatestPerGroup(groupIds).stream()
                .collect(Collectors.toMap(ChatMessage::getGroupId, Function.identity()));

        Map<UUID, Long> unreadByGroup = new HashMap<>();
        for (ChatMessageRepository.UnreadCount row : chatMessageRepository.countUnreadPerGroup(groupIds, userId)) {
            unreadByGroup.put(row.getGroupId(), row.getUnreadCount());
        }

        List<ChatRoomResponse> rooms = new ArrayList<>(groupIds.size());
        for (UUID groupId : groupIds) {
            ChatMessage latest = latestByGroup.get(groupId);
            rooms.add(new ChatRoomResponse(
                    groupId,
                    latest == null ? null : ChatMessageResponse.from(latest),
                    // 안 읽음이 0 인 방은 집계 쿼리에 행이 없다 — 없으면 0 이다.
                    unreadByGroup.getOrDefault(groupId, 0L)));
        }

        // 마지막 메시지 id 내림차순(= 최근순). 메시지가 없는 방은 null 이라 맨 뒤로.
        rooms.sort(Comparator.comparing(
                (ChatRoomResponse r) -> r.lastMessage() == null ? null : r.lastMessage().messageId(),
                Comparator.nullsLast(Comparator.reverseOrder())));
        return rooms;
    }

    /**
     * 「여기까지 읽었다」를 기록한다 — 커서는 앞으로만 간다.
     *
     * <p>이미 더 읽은 상태에서 옛 위치가 들어오면 <b>아무 일도 일어나지 않고 정상 응답</b>이다.
     * 실패로 다루지 않는 이유: 화면 두 개가 각자 읽음을 보고하는 건 정상이고, 늦게 도착한 쪽을
     * 오류로 만들면 앱이 재시도 루프를 돈다.
     *
     * <p>새 행에 쓸 id 를 여기서 만들어 넘긴다. 엔티티를 저장하는 게 아니라 native UPSERT 라
     * Hibernate 의 id 생성기가 개입하지 않기 때문이다 — 같은 UUID v7 을 써야 PK 정렬 관례가 유지된다.
     *
     * <p>여기도 트랜잭션을 열지 않는다({@code myRooms} 와 같은 이유). 쓰기는 UPSERT 한 문장이고,
     * 그 문장의 트랜잭션은 리포지토리 메서드가 스스로 연다.
     *
     * <h3>커서가 «그 방의 메시지»인지 반드시 검증한다</h3>
     * 멤버십만 보고 값을 그대로 저장하면, 클라이언트가 다른 방의 id 나 <b>임의의 큰 UUID</b> 를 한 번
     * 보내는 것으로 그 방을 영구히 침묵시킬 수 있다. 안 읽음은 {@code id > 커서} 로 세고 커서는 뒤로
     * 가지 않으므로, 미래 시각의 v7 이 한 번 박히면 그 방의 <b>앞으로 올 메시지까지 전부 읽은 것으로
     * 숨겨진다</b> — 게다가 스스로 풀리지 않는다. 검증 한 번(인덱스 조회)이 그 문을 닫는다.
     *
     * @throws ChatException {@code INVALID_CURSOR} — 그 섬에 없는 메시지 id
     */
    public void markRead(UUID groupId, UUID userId, UUID lastReadMessageId, String bearerToken) {
        accessGuard.requireCanChat(groupId, userId, bearerToken);

        if (!chatMessageRepository.existsByIdAndGroupId(lastReadMessageId, groupId)) {
            throw new ChatException(ChatErrorCode.INVALID_CURSOR);
        }

        chatReadCursorRepository.upsertIfNewer(
                UuidV7.next(), groupId, userId, lastReadMessageId, clock.instant());
    }
}

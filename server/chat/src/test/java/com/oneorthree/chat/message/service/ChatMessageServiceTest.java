package com.oneorthree.chat.message.service;

import com.oneorthree.chat.common.id.UuidV7;
import com.oneorthree.chat.fanout.ChatFanout;
import com.oneorthree.chat.message.dto.ChatHistoryResponse;
import com.oneorthree.chat.message.dto.ChatMessageResponse;
import com.oneorthree.chat.message.dto.SendMessageRequest;
import com.oneorthree.chat.message.exception.ChatErrorCode;
import com.oneorthree.chat.message.exception.ChatException;
import com.oneorthree.chat.message.repository.ChatMessageRepository;
import com.oneorthree.chat.message.repository.domain.ChatMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 발신 규칙과 히스토리 페이징.
 *
 * <p>저장소·관문·팬아웃은 목이다 — 여기서 보려는 것은 <b>서비스가 내리는 판단</b>이지 SQL 이 아니다
 * (SQL 은 {@code ChatMessageRepositoryTest} 가 실물 Postgres 로 본다).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ChatMessageServiceTest {

    private static final String BEARER = "Bearer test-token";

    /** 재전송 되돌림이 «이 세션에만» 가야 한다 — 값 자체엔 의미가 없고, 전달되는지가 요점이다. */
    private static final String SESSION_ID = "stomp-session-1";
    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");

    @Mock
    private ChatMessageRepository chatMessageRepository;

    @Mock
    private ChatAccessGuard accessGuard;

    @Mock
    private ChatFanout chatFanout;

    private ChatMessageService chatMessageService;

    private UUID groupId;
    private UUID senderId;

    @BeforeEach
    void setUp() {
        groupId = UUID.randomUUID();
        senderId = UUID.randomUUID();
        chatMessageService = new ChatMessageService(chatMessageRepository, accessGuard, chatFanout,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("관문이 거절하면 저장도 브로드캐스트도 없다")
    void rejectedBeforeAnySideEffect() {
        willThrow(new ChatException(ChatErrorCode.FOCUS_IN_PROGRESS))
                .given(accessGuard).requireCanChat(groupId, senderId, BEARER);

        assertThatThrownBy(() -> chatMessageService.send(groupId, senderId, request("안녕"), BEARER, SESSION_ID))
                .isInstanceOf(ChatException.class);

        verify(chatMessageRepository, never()).save(any());
        verify(chatFanout, never()).broadcast(any());
    }

    @Test
    @DisplayName("공백만 있는 말은 거절한다 — 방에 빈 말풍선을 남기지 않는다")
    void rejectsBlank() {
        assertThatThrownBy(() -> chatMessageService.send(groupId, senderId, request("   \n "), BEARER, SESSION_ID))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.BLANK_CONTENT);
    }

    @Test
    @DisplayName("양끝 공백은 떼고 저장한다 — 길이 판정도 뗀 뒤의 길이로 한다")
    void stripsSurroundingWhitespace() {
        givenSaveEchoes();

        ChatMessageResponse sent = chatMessageService.send(groupId, senderId, request("  안녕  "), BEARER, SESSION_ID);

        assertThat(sent.content()).isEqualTo("안녕");
    }

    @Test
    @DisplayName("상한을 넘으면 DB 까지 가지 않고 400 으로 거절한다")
    void rejectsTooLong() {
        String tooLong = "가".repeat(ChatMessageService.MAX_CONTENT_LENGTH + 1);

        assertThatThrownBy(() -> chatMessageService.send(groupId, senderId, request(tooLong), BEARER, SESSION_ID))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.CONTENT_TOO_LONG);

        verify(chatMessageRepository, never()).save(any());
    }

    @Test
    @DisplayName("상한 «정확히»는 통과한다 — 경계에서 한 칸 어긋나지 않는지")
    void allowsExactlyMaxLength() {
        givenSaveEchoes();
        String exact = "가".repeat(ChatMessageService.MAX_CONTENT_LENGTH);

        assertThat(chatMessageService.send(groupId, senderId, request(exact), BEARER, SESSION_ID).content())
                .hasSize(ChatMessageService.MAX_CONTENT_LENGTH);
    }

    @Test
    @DisplayName("재전송은 처음 저장된 그 메시지를 돌려준다 — 새로 만들지 않는다")
    void resendReturnsOriginal() {
        UUID clientMessageId = uuid();
        ChatMessage original = persisted(groupId, senderId, "안녕", clientMessageId);

        willThrow(new DataIntegrityViolationException("unique")).given(chatMessageRepository).save(any());
        given(chatMessageRepository.findByGroupIdAndSenderIdAndClientMessageId(groupId, senderId, clientMessageId))
                .willReturn(Optional.of(original));

        ChatMessageResponse sent = chatMessageService.send(
                groupId, senderId, new SendMessageRequest("안녕", clientMessageId), BEARER, SESSION_ID);

        assertThat(sent.messageId()).isEqualTo(original.getId());
    }

    @Test
    @DisplayName("재전송은 «다시 방송하지 않는다» — 같은 messageId 가 두 번 도착하면 대화가 겹쳐 보인다")
    void resendDoesNotRebroadcast() {
        UUID clientMessageId = uuid();
        ChatMessage original = persisted(groupId, senderId, "안녕", clientMessageId);

        willThrow(new DataIntegrityViolationException("unique")).given(chatMessageRepository).save(any());
        given(chatMessageRepository.findByGroupIdAndSenderIdAndClientMessageId(groupId, senderId, clientMessageId))
                .willReturn(Optional.of(original));

        chatMessageService.send(groupId, senderId, new SendMessageRequest("안녕", clientMessageId), BEARER, SESSION_ID);

        verify(chatFanout, never()).broadcast(any());
    }

    @Test
    @DisplayName("재전송은 «보낸 사람에게만» 원본을 되돌린다 — 없으면 그 클라이언트는 무한히 다시 보낸다")
    void resendEchoesBackToTheSenderOnly() {
        UUID clientMessageId = uuid();
        ChatMessage original = persisted(groupId, senderId, "안녕", clientMessageId);

        willThrow(new DataIntegrityViolationException("unique")).given(chatMessageRepository).save(any());
        given(chatMessageRepository.findByGroupIdAndSenderIdAndClientMessageId(groupId, senderId, clientMessageId))
                .willReturn(Optional.of(original));

        chatMessageService.send(groupId, senderId, new SendMessageRequest("안녕", clientMessageId), BEARER, SESSION_ID);

        ArgumentCaptor<ChatMessageResponse> echoed = ArgumentCaptor.forClass(ChatMessageResponse.class);
        verify(chatFanout).deliverToSender(eq(senderId), eq(SESSION_ID), echoed.capture());
        assertThat(echoed.getValue().messageId()).isEqualTo(original.getId());
    }

    @Test
    @DisplayName("처음 저장은 방송만 한다 — 발신자에게 토픽과 개인 큐로 «두 번» 도착하면 안 된다")
    void firstSendDoesNotAlsoEchoPersonally() {
        givenSaveEchoes();

        chatMessageService.send(groupId, senderId, request("안녕"), BEARER, SESSION_ID);

        verify(chatFanout).broadcast(any());
        verify(chatFanout, never()).deliverToSender(any(), any(), any());
    }

    @Test
    @DisplayName("제약 위반인데 원본을 못 찾으면 «다른 이유»의 위반이다 — 삼키지 않고 올린다")
    void unrelatedIntegrityViolationIsNotSwallowed() {
        UUID clientMessageId = uuid();
        willThrow(new DataIntegrityViolationException("not a dedup violation"))
                .given(chatMessageRepository).save(any());
        given(chatMessageRepository.findByGroupIdAndSenderIdAndClientMessageId(groupId, senderId, clientMessageId))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> chatMessageService.send(
                groupId, senderId, new SendMessageRequest("안녕", clientMessageId), BEARER, SESSION_ID))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("브로드캐스트는 저장 «뒤»다 — 소켓엔 왔는데 히스토리엔 없는 말을 만들지 않는다")
    void broadcastsSavedMessage() {
        givenSaveEchoes();

        ChatMessageResponse sent = chatMessageService.send(groupId, senderId, request("안녕"), BEARER, SESSION_ID);

        verify(chatFanout).broadcast(sent);
    }

    @Test
    @DisplayName("히스토리는 요청 크기보다 한 건 더 읽어 hasMore 를 판정하고, 그 한 건은 응답에서 뺀다")
    void detectsHasMoreWithoutCountQuery() {
        List<ChatMessage> rows = sequence(4);
        given(chatMessageRepository.findByGroupIdOrderByIdDesc(any(), any(Pageable.class))).willReturn(rows);

        ChatHistoryResponse history = chatMessageService.history(groupId, senderId, null, 3, BEARER);

        assertThat(history.messages()).hasSize(3);
        assertThat(history.hasMore()).isTrue();
        // 다음 커서는 이 페이지의 «가장 오래된» 것 = 내림차순 목록의 마지막.
        assertThat(history.nextCursor()).isEqualTo(history.messages().get(2).messageId());
    }

    @Test
    @DisplayName("더 없으면 커서는 null 이다 — 앱이 무한 스크롤을 멈출 근거")
    void lastPageHasNoCursor() {
        given(chatMessageRepository.findByGroupIdOrderByIdDesc(any(), any(Pageable.class)))
                .willReturn(sequence(2));

        ChatHistoryResponse history = chatMessageService.history(groupId, senderId, null, 3, BEARER);

        assertThat(history.hasMore()).isFalse();
        assertThat(history.nextCursor()).isNull();
    }

    @Test
    @DisplayName("size 는 상한으로 잘린다 — size=100000 한 방으로 메모리를 태우지 못한다")
    void clampsPageSize() {
        given(chatMessageRepository.findByGroupIdOrderByIdDesc(any(), any(Pageable.class)))
                .willReturn(List.of());

        chatMessageService.history(groupId, senderId, null, 100_000, BEARER);

        verify(chatMessageRepository).findByGroupIdOrderByIdDesc(any(),
                org.mockito.ArgumentMatchers.argThat(
                        p -> p.getPageSize() == ChatMessageService.MAX_PAGE_SIZE + 1));
    }

    @Test
    @DisplayName("히스토리도 관문을 통과해야 한다 — 남의 섬 기록을 읽을 수 없다")
    void historyIsGuarded() {
        willThrow(new ChatException(ChatErrorCode.NOT_A_MEMBER))
                .given(accessGuard).requireCanChat(groupId, senderId, BEARER);

        assertThatThrownBy(() -> chatMessageService.history(groupId, senderId, null, null, BEARER))
                .isInstanceOf(ChatException.class);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** 저장이 입력을 그대로 돌려주게 한다(id 를 채워서) — 서비스의 판단만 보기 위한 최소 스텁. */
    private void givenSaveEchoes() {
        given(chatMessageRepository.save(any())).willAnswer(invocation -> {
            ChatMessage m = invocation.getArgument(0);
            ReflectionTestUtils.setField(m, "id", uuid());
            return m;
        });
    }

    private SendMessageRequest request(String content) {
        return new SendMessageRequest(content, uuid());
    }

    private ChatMessage persisted(UUID groupId, UUID senderId, String content, UUID clientMessageId) {
        ChatMessage m = ChatMessage.builder()
                .groupId(groupId).senderId(senderId).content(content)
                .clientMessageId(clientMessageId).sentAt(NOW).build();
        ReflectionTestUtils.setField(m, "id", uuid());
        return m;
    }

    private List<ChatMessage> sequence(int count) {
        List<ChatMessage> rows = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            rows.add(persisted(groupId, senderId, String.valueOf(i), uuid()));
        }
        return rows;
    }

    private static UUID uuid() {
        return UuidV7.next();
    }
}

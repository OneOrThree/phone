package com.oneorthree.chat.message.repository;

import com.oneorthree.chat.TestcontainersConfiguration;
import com.oneorthree.chat.common.id.UuidV7;
import com.oneorthree.chat.message.repository.domain.ChatMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 저장소 계약 — <b>실제 Postgres 위에서만 확인되는 것들</b>만 여기서 본다.
 *
 * <p>커서 페이징의 경계, 유니크 제약의 재전송 차단, {@code DISTINCT ON} · {@code ON CONFLICT … WHERE}
 * 같은 Postgres 전용 문법은 목으로는 한 글자도 검증되지 않는다.
 */
@SpringBootTest
@Transactional
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class ChatMessageRepositoryTest {

    @Autowired
    private ChatMessageRepository chatMessageRepository;

    @Autowired
    private ChatReadCursorRepository chatReadCursorRepository;

    private UUID groupA;
    private UUID groupB;
    private UUID alice;
    private UUID bob;

    @BeforeEach
    void setUp() {
        groupA = uuid();
        groupB = uuid();
        alice = uuid();
        bob = uuid();
    }

    @Nested
    @DisplayName("재전송 차단")
    class Dedup {

        @Test
        @DisplayName("같은 (섬, 발신자, clientMessageId) 두 번째 저장은 제약에 걸린다")
        void rejectsDuplicate() {
            UUID clientMessageId = uuid();
            chatMessageRepository.saveAndFlush(message(groupA, alice, "안녕", clientMessageId));

            assertThatThrownBy(() ->
                    chatMessageRepository.saveAndFlush(message(groupA, alice, "안녕", clientMessageId)))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }

        @Test
        @DisplayName("발신자가 다르면 같은 clientMessageId 라도 통과한다 — 키는 발신자별로 유일하다")
        void allowsSameKeyFromDifferentSender() {
            UUID clientMessageId = uuid();
            chatMessageRepository.saveAndFlush(message(groupA, alice, "안녕", clientMessageId));
            chatMessageRepository.saveAndFlush(message(groupA, bob, "안녕", clientMessageId));

            assertThat(chatMessageRepository.findAll()).hasSize(2);
        }

        @Test
        @DisplayName("제약에 걸린 뒤 원래 메시지를 찾을 수 있다 — 재전송 복구 경로")
        void findsOriginal() {
            UUID clientMessageId = uuid();
            ChatMessage first = chatMessageRepository.saveAndFlush(message(groupA, alice, "안녕", clientMessageId));

            assertThat(chatMessageRepository
                    .findByGroupIdAndSenderIdAndClientMessageId(groupA, alice, clientMessageId))
                    .get()
                    .extracting(ChatMessage::getId)
                    .isEqualTo(first.getId());
        }
    }

    @Nested
    @DisplayName("저장할 수 없는 문자")
    class UnstorableCharacters {

        @Test
        @DisplayName("NUL 이 든 본문은 «실제로» 저장에 실패한다 — 서비스가 먼저 막는 이유의 근거")
        void nulCannotBeStored() {
            // 이 전제가 틀리면 ChatMessageService 의 NUL 검사는 근거 없는 거절이 된다. 그래서
            // 가정하지 않고 실물 Postgres 에 물어본다.
            //
            // 「그 실패가 재전송과 구별되지 않는다」까지 여기서 이어 보려다 접었다 — 이 테스트는 한
            // 트랜잭션 안이라 실패한 뒤 «그 트랜잭션이 통째로 abort» 되어, 운영과 다른 이유로 깨진다.
            // 운영의 send() 는 비트랜잭션이라 그 조회가 «새» 트랜잭션에서 빈손으로 돌아오고, 그래서
            // 원래 예외가 그대로 올라간다. 그 경로에 도달하지 않는다는 것은 서비스 단위 테스트가 본다.
            assertThatThrownBy(() ->
                    chatMessageRepository.saveAndFlush(message(groupA, alice, "\uc548\u0000\ub155", uuid())))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }

    }

    @Nested
    @DisplayName("커서 페이징")
    class Paging {

        @Test
        @DisplayName("최신부터 내려오고, 커서 «미만»이라 경계 메시지가 겹치지 않는다")
        void pagesBackwardsWithoutOverlap() {
            List<ChatMessage> saved = saveSequence(groupA, alice, 5);

            List<ChatMessage> firstPage =
                    chatMessageRepository.findByGroupIdOrderByIdDesc(groupA, PageRequest.of(0, 2));
            assertThat(firstPage).extracting(ChatMessage::getContent).containsExactly("4", "3");

            UUID cursor = firstPage.get(firstPage.size() - 1).getId();
            List<ChatMessage> secondPage = chatMessageRepository
                    .findByGroupIdAndIdLessThanOrderByIdDesc(groupA, cursor, PageRequest.of(0, 2));

            // 커서 자신("3")은 다시 나오지 않는다 — <= 였다면 여기서 겹친다.
            assertThat(secondPage).extracting(ChatMessage::getContent).containsExactly("2", "1");
            assertThat(saved).hasSize(5);
        }

        @Test
        @DisplayName("다른 섬의 메시지는 섞이지 않는다")
        void isolatesGroups() {
            saveSequence(groupA, alice, 2);
            saveSequence(groupB, bob, 3);

            assertThat(chatMessageRepository.findByGroupIdOrderByIdDesc(groupA, PageRequest.of(0, 10)))
                    .hasSize(2);
        }
    }

    @Nested
    @DisplayName("방 목록 집계")
    class RoomAggregates {

        @Test
        @DisplayName("DISTINCT ON — 섬마다 마지막 메시지 한 건씩만, 한 번의 쿼리로")
        void latestPerGroup() {
            saveSequence(groupA, alice, 3);
            saveSequence(groupB, bob, 2);

            Map<UUID, String> latest = new HashMap<>();
            for (ChatMessage m : chatMessageRepository.findLatestPerGroup(List.of(groupA, groupB))) {
                latest.put(m.getGroupId(), m.getContent());
            }

            assertThat(latest).containsEntry(groupA, "2").containsEntry(groupB, "1");
        }

        @Test
        @DisplayName("커서가 없으면 남이 보낸 말 전부가 안 읽음이다")
        void countsAllWhenNoCursor() {
            saveSequence(groupA, bob, 3);

            assertThat(unreadOf(alice, groupA)).isEqualTo(3);
        }

        @Test
        @DisplayName("내가 보낸 말은 안 읽음에서 뺀다 — 아니면 말할 때마다 내 배지가 오른다")
        void excludesOwnMessages() {
            saveSequence(groupA, alice, 3);

            assertThat(unreadOf(alice, groupA)).isZero();
        }

        @Test
        @DisplayName("커서 뒤에 온 것만 센다")
        void countsAfterCursor() {
            List<ChatMessage> messages = saveSequence(groupA, bob, 4);
            markRead(groupA, alice, messages.get(1).getId());

            assertThat(unreadOf(alice, groupA)).isEqualTo(2);
        }

        @Test
        @DisplayName("안 읽음이 0 인 섬은 집계 결과에 «행이 없다» — 호출부가 0 으로 채워야 한다")
        void omitsGroupsWithZeroUnread() {
            saveSequence(groupA, alice, 2);

            assertThat(chatMessageRepository.countUnreadPerGroup(List.of(groupA), alice)).isEmpty();
        }
    }

    @Nested
    @DisplayName("읽음 커서 UPSERT")
    class ReadCursor {

        @Test
        @DisplayName("없으면 만든다")
        void inserts() {
            UUID messageId = uuid();

            assertThat(markRead(groupA, alice, messageId)).isEqualTo(1);
            assertThat(chatReadCursorRepository.findByGroupIdAndUserId(groupA, alice))
                    .get().extracting("lastReadMessageId").isEqualTo(messageId);
        }

        @Test
        @DisplayName("앞으로 가는 갱신은 반영된다")
        void advances() {
            UUID older = uuid();
            UUID newer = uuid();
            markRead(groupA, alice, older);

            assertThat(markRead(groupA, alice, newer)).isEqualTo(1);
            assertThat(chatReadCursorRepository.findByGroupIdAndUserId(groupA, alice))
                    .get().extracting("lastReadMessageId").isEqualTo(newer);
        }

        @Test
        @DisplayName("뒤로 가는 갱신은 «조용히» 무시된다 — 예외가 아니라 0행이다")
        void doesNotRewind() {
            UUID older = uuid();
            UUID newer = uuid();
            markRead(groupA, alice, newer);

            assertThat(markRead(groupA, alice, older)).isZero();
            assertThat(chatReadCursorRepository.findByGroupIdAndUserId(groupA, alice))
                    .get().extracting("lastReadMessageId").isEqualTo(newer);
        }

        @Test
        @DisplayName("같은 섬이라도 사람이 다르면 커서가 따로 선다")
        void perUser() {
            markRead(groupA, alice, uuid());
            markRead(groupA, bob, uuid());

            assertThat(chatReadCursorRepository.count()).isEqualTo(2);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** 시간 순서가 보장된 v7 id 를 얻으려고 리포지토리 저장을 순차로 한다. 내용은 인덱스 문자열이다. */
    private List<ChatMessage> saveSequence(UUID groupId, UUID senderId, int count) {
        List<ChatMessage> saved = new java.util.ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            saved.add(chatMessageRepository.saveAndFlush(message(groupId, senderId, String.valueOf(i), uuid())));
        }
        return saved;
    }

    private ChatMessage message(UUID groupId, UUID senderId, String content, UUID clientMessageId) {
        return ChatMessage.builder()
                .groupId(groupId)
                .senderId(senderId)
                .content(content)
                .clientMessageId(clientMessageId)
                .sentAt(Instant.now())
                .build();
    }

    private int markRead(UUID groupId, UUID userId, UUID messageId) {
        return chatReadCursorRepository.upsertIfNewer(uuid(), groupId, userId, messageId, Instant.now());
    }

    private long unreadOf(UUID userId, UUID groupId) {
        return chatMessageRepository.countUnreadPerGroup(List.of(groupId), userId).stream()
                .filter(row -> row.getGroupId().equals(groupId))
                .mapToLong(ChatMessageRepository.UnreadCount::getUnreadCount)
                .sum();
    }

    /**
     * 테스트도 제품과 «같은 발급구»를 쓴다. 여기서 별도 생성기를 만들면 같은 밀리초 안의 단조성이
     * 사라져, 제품은 멀쩡한데 순서 단언만 무작위로 깨지는 실패가 난다({@link UuidV7} 참조).
     */
    private static UUID uuid() {
        return UuidV7.next();
    }
}

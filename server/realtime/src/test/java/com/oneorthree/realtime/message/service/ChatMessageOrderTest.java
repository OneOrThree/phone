package com.oneorthree.realtime.message.service;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.common.id.UuidV7;
import com.oneorthree.realtime.message.dto.ChatMessageResponse;
import com.oneorthree.realtime.message.dto.SendMessageRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 「id 순서 = 커밋 순서」 — 커서 페이징·안 읽음 배지가 얹혀 있는 가정을 실물 Postgres 로 본다 (GROMO-1741 §②).
 *
 * <p>트랜잭션을 넘나드는 경합이라 {@code @Transactional} 로 감싸지 않는다 — 감싸면 커밋이 없어 볼 것이 없다.
 * 대신 이 클래스가 남긴 행은 {@link #cleanUp} 이 지운다(같은 컨텍스트의 다른 테스트가 행 수를 센다).
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class ChatMessageOrderTest {

    @Autowired
    private ChatMessageService chatMessageService;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Autowired
    private JdbcTemplate jdbc;

    private UUID room;

    @BeforeEach
    void setUp() {
        room = UUID.randomUUID();
    }

    @AfterEach
    void cleanUp() {
        jdbc.update("DELETE FROM chat_messages WHERE group_id = ?", room);
    }

    @Test
    @DisplayName("더 작은 id 가 더 늦게 커밋되지 않는다 — B 가 보이는 순간, B 보다 작은 id 는 전부 이미 보인다")
    void smallerIdNeverCommitsLater() throws Exception {
        CountDownLatch aStored = new CountDownLatch(1);
        CountDownLatch releaseA = new CountDownLatch(1);

        // A: 저장까지 하고 커밋을 붙잡는다 — INSERT 와 COMMIT 사이의 창을 넓혀 재현한다.
        CompletableFuture<ChatMessageResponse> a = CompletableFuture.supplyAsync(() ->
                transactionTemplate.execute(status -> {
                    ChatMessageResponse stored = store("A");
                    aStored.countDown();
                    await(releaseA);
                    return stored;
                }));
        assertThat(aStored.await(10, TimeUnit.SECONDS)).isTrue();

        // B: 그 창 안에서 같은 방에 말한다. 돌아온 «직후» 무엇이 보이는지 찍는다.
        CompletableFuture<Observed> b = CompletableFuture.supplyAsync(() -> {
            ChatMessageResponse stored = store("B");
            return new Observed(stored.messageId(), visibleIds());
        });
        try {
            b.get(1, TimeUnit.SECONDS);
        } catch (TimeoutException expected) {
            // 고친 뒤엔 B 가 A 의 커밋을 기다린다 — 기다리는 게 정답이다.
        }
        releaseA.countDown();

        ChatMessageResponse stored = a.get(10, TimeUnit.SECONDS);
        Observed observed = b.get(10, TimeUnit.SECONDS);

        // B 를 본 클라이언트가 커서를 B 로 들고 가면, 그보다 작은 id 가 나중에 나타나도 영영 못 본다.
        List<UUID> smallerThanB = visibleIds().stream().filter(id -> id.compareTo(observed.id()) < 0).toList();
        assertThat(observed.visibleAtCommit()).containsAll(smallerThanB);
        assertThat(stored.messageId()).isLessThan(observed.id());
    }

    @Test
    @DisplayName("다른 인스턴스의 시계가 앞서 있어도 새 말은 방의 마지막 말보다 뒤에 선다")
    void newMessageSortsAfterRoomLatestEvenWithClockSkew() {
        // 시계가 1분 앞선 다른 인스턴스가 먼저 커밋한 말을 흉내 낸다.
        UUID now = UuidV7.next();
        UUID future = new UUID(now.getMostSignificantBits() + (60_000L << 16), now.getLeastSignificantBits());
        jdbc.update("INSERT INTO chat_messages (id, group_id, sender_id, content, client_message_id, sent_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                future, room, UUID.randomUUID(), "앞선 인스턴스", UUID.randomUUID(), Timestamp.from(Instant.now()));

        ChatMessageResponse next = store("다음 말");

        assertThat(next.messageId()).isGreaterThan(future);
        assertThat(visibleIds().get(visibleIds().size() - 1)).isEqualTo(next.messageId());
    }

    private record Observed(UUID id, List<UUID> visibleAtCommit) {
    }

    private ChatMessageResponse store(String content) {
        return chatMessageService.storeFromMailbox(room, UUID.randomUUID(),
                new SendMessageRequest(content, UUID.randomUUID())).message();
    }

    /** 커밋돼 보이는 id — Postgres 의 uuid 비교(바이트 순) 오름차순. */
    private List<UUID> visibleIds() {
        return jdbc.queryForList("SELECT id FROM chat_messages WHERE group_id = ? ORDER BY id", UUID.class, room);
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

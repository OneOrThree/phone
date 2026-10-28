package com.oneorthree.realtime.message.service;

import com.oneorthree.realtime.common.id.UuidV7;
import com.oneorthree.realtime.message.repository.domain.ChatMessage;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.UUID;

/**
 * 메시지 저장의 <b>유일한</b> 입구 — 방 단위로 «id 순서 = 커밋 순서»를 보장한다 (GROMO-1741 §②).
 *
 * <p>커서 페이징({@code id < :cursor})과 안 읽음({@code id > 읽음 커서})은 «더 작은 id 는 이미 보인다»를
 * 믿는다. 그런데 id 를 INSERT 때 발급하고 커밋은 그 뒤라, 같은 방 동시 발신에서 더 작은 id 가 더 늦게
 * 커밋될 수 있었다 — 그 창에서 B 를 본 클라이언트는 나중에 나타난 A 를 커서 뒤에서 영영 못 본다.
 * 여러 인스턴스면 시계 차이만큼 창이 더 넓다.
 *
 * <p>그래서 한 트랜잭션 안에서 <b>방 잠금 → 방의 마지막 id 읽기 → 그보다 큰 id 로 INSERT</b> 를 한다.
 * 잠금은 커밋 때 풀리므로 다음 발신자는 앞 발신이 커밋된 뒤에야 마지막 id 를 읽는다 — 즉 방 안에서는
 * 발급 순서가 곧 커밋 순서다. 마지막 id 보다 크게 만드는 것은 앞선 시계를 가진 다른 인스턴스가 먼저
 * 커밋한 경우를 위해서다.
 *
 * <p>잠금은 {@code ChatUserFence} 와 같은 트랜잭션 범위 advisory lock 이다 — 방 행이 없는 서비스라 행
 * 잠금을 걸 대상이 없다. 대가는 <b>같은 방 발신의 직렬화</b>(단일 행 INSERT 하나 길이)다.
 *
 * <p>유니크 제약 위반(재전송)은 {@code DataIntegrityViolationException} 으로 그대로 올라간다 — 이 트랜잭션은
 * 롤백되고, 원본 조회는 호출부가 새 트랜잭션에서 한다({@code ChatMessageService#insertOrFindExisting}).
 */
@Component
@RequiredArgsConstructor
public class ChatMessageAppender {

    private final JdbcTemplate jdbc;

    /**
     * @param draft 저장할 말. {@code id} 는 무시하고 여기서 정한다
     * @return id 가 채워진 저장본
     */
    @Transactional
    public ChatMessage append(ChatMessage draft) {
        // ponytail: 방당 잠금 하나. 한 방이 초당 수천 건이 되면 커밋 순번 워터마크로 바꾼다.
        jdbc.queryForObject("SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(?, 0))", Integer.class,
                "chat-room:" + draft.getGroupId());
        UUID last = jdbc.query("SELECT id FROM chat_messages WHERE group_id = ? ORDER BY id DESC LIMIT 1",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, draft.getGroupId());
        UUID id = after(UuidV7.next(), last);
        jdbc.update("INSERT INTO chat_messages (id, group_id, sender_id, content, client_message_id, sent_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                id, draft.getGroupId(), draft.getSenderId(), draft.getContent(), draft.getClientMessageId(),
                Timestamp.from(draft.getSentAt()));
        return ChatMessage.builder()
                .id(id)
                .groupId(draft.getGroupId())
                .senderId(draft.getSenderId())
                .content(draft.getContent())
                .clientMessageId(draft.getClientMessageId())
                .sentAt(draft.getSentAt())
                .build();
    }

    /**
     * {@code candidate} 가 {@code last} 보다 크면 그대로, 아니면 {@code last} 바로 다음 값.
     *
     * <p>비교는 Postgres 의 uuid 비교(바이트 순 = 부호 없는 비교)와 같아야 한다 — {@link UUID#compareTo} 는
     * 부호 있는 비교라 쓰지 않는다. 하위 64비트에 1 을 더하면 v7 의 무작위 부분만 바뀐다(하위 62비트가
     * 전부 1 인 경우 variant 비트로 올림되지만 순서와 유일성은 그대로다).
     */
    static UUID after(UUID candidate, UUID last) {
        if (last == null || compareUnsigned(candidate, last) > 0) {
            return candidate;
        }
        long lsb = last.getLeastSignificantBits() + 1;
        long msb = last.getMostSignificantBits() + (lsb == 0 ? 1 : 0);
        return new UUID(msb, lsb);
    }

    private static int compareUnsigned(UUID a, UUID b) {
        int high = Long.compareUnsigned(a.getMostSignificantBits(), b.getMostSignificantBits());
        return high != 0 ? high : Long.compareUnsigned(a.getLeastSignificantBits(), b.getLeastSignificantBits());
    }
}

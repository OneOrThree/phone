package com.oneorthree.realtime.message.service;

import com.oneorthree.realtime.common.id.UuidV7;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.repository.ChatMessageRepository;
import com.oneorthree.realtime.message.repository.ChatReadCursorRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.UUID;

/**
 * 탈퇴 tombstone 과 읽음 커서 쓰기를 <b>같은 사용자 잠금</b>으로 직렬화한다 (GROMO-1943 · 계정 LLD §4).
 *
 * <p>잠금은 사용자 UUID 로 정해지는 트랜잭션 범위 advisory lock 이다 — 커서·tombstone 행이 아직 없는
 * 사용자도 같은 키로 잠가야 해서 행 잠금으로는 안 된다. 두 순서 모두 닫힌다:
 * <ul>
 *   <li>커서 쓰기가 먼저 잠그면 탈퇴 처리가 기다렸다가 방금 쓴 커서까지 지운다</li>
 *   <li>탈퇴 처리가 먼저면 이미 멤버십 검사를 통과한 요청도 잠금 뒤 tombstone 을 보고 거절된다</li>
 * </ul>
 * 멤버십 캐시(최대 120초)가 탈퇴자를 통과시켜도 여기서 막힌다 — 캐시 무효화는 보조일 뿐이다.
 */
@Service
@RequiredArgsConstructor
public class ChatUserFence {

    private final JdbcTemplate jdbc;
    private final ChatReadCursorRepository chatReadCursorRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final Clock clock;

    /**
     * {@code user.withdrawn} 적용 — tombstone 확정 → 그 사용자의 모든 방 커서 삭제. 한 로컬 TX 다.
     *
     * <p>멱등이다: 두 번째 전달은 세대를 {@code GREATEST} 로만 맞추고 지울 커서가 없다. 역순으로 온 낮은
     * 세대가 폐기를 되돌리지도 않는다.
     *
     * @return 지운 커서 행 수
     */
    @Transactional
    public int withdraw(UUID userId, long authGeneration) {
        lock(userId);
        jdbc.update("INSERT INTO user_tombstones (user_id, auth_generation, withdrawn_at) VALUES (?, ?, ?)"
                + " ON CONFLICT (user_id) DO UPDATE SET auth_generation ="
                + " GREATEST(user_tombstones.auth_generation, EXCLUDED.auth_generation)",
                userId, authGeneration, Timestamp.from(clock.instant()));
        return jdbc.update("DELETE FROM chat_read_cursors WHERE user_id = ?", userId);
    }

    /**
     * 읽음 커서 저장의 <b>유일한</b> 관문 — 사용자 잠금 → tombstone 재검사 → 메시지 소속 재검사 → UPSERT.
     *
     * <p>외부 접근 검사(Redis·Data HTTP)는 호출부가 이 TX <b>밖</b>에서 끝낸다 — 커넥션을 쥔 채 네트워크를
     * 기다리지 않는다.
     *
     * @throws ChatException 탈퇴한 사용자면 {@code NOT_A_MEMBER}, 그 섬의 메시지가 아니면 {@code INVALID_CURSOR}
     */
    @Transactional
    public void writeReadCursor(UUID groupId, UUID userId, UUID lastReadMessageId) {
        lock(userId);
        if (isWithdrawn(userId)) {
            throw new ChatException(ChatErrorCode.NOT_A_MEMBER);
        }
        if (!chatMessageRepository.existsByIdAndGroupId(lastReadMessageId, groupId)) {
            throw new ChatException(ChatErrorCode.INVALID_CURSOR);
        }
        chatReadCursorRepository.upsertIfNewer(UuidV7.next(), groupId, userId, lastReadMessageId, clock.instant());
    }

    private boolean isWithdrawn(UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM user_tombstones WHERE user_id = ?)", Boolean.class, userId));
    }

    private void lock(UUID userId) {
        jdbc.queryForObject("SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(?, 0))", Integer.class,
                "chat-user:" + userId);
    }
}

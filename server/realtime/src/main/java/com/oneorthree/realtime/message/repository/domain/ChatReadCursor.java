package com.oneorthree.realtime.message.repository.domain;

import com.oneorthree.realtime.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 「이 사람이 이 섬에서 어디까지 읽었는가」.
 *
 * <p>이 테이블이 있어야 <b>채팅에 푸시 알림이 없다</b>는 결정이 성립한다. 알림이 없으니 안 읽은 말은
 * 방에 쌓이기만 하고, 「몇 개 쌓였는지」를 셀 근거가 필요하다 — 그게 이 커서다. 집중 중에 방에 못
 * 들어가는 동안 쌓인 양도 같은 방식으로 세어진다.
 *
 * <p>안 읽음 개수를 숫자로 저장하지 않고 커서로 두는 이유: 개수는 메시지가 들어올 때마다 방 인원수만큼
 * 증가시켜야 하고(N배 쓰기), 한 번 어긋나면 스스로 못 고친다. 커서는 읽을 때 한 번 쓰고 개수는 셀
 * 때 계산하므로 언제나 실제 데이터와 일치한다.
 */
@Entity
@Getter
@Table(name = "chat_read_cursors")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChatReadCursor {

    /**
     * 대리 PK. 자연키는 {@code (group_id, user_id)} 이고 그쪽에 유니크 제약이 걸려 있다 —
     * 복합 PK 대신 대리키를 쓰는 건 이 레포의 관례(엔티티 PK 는 UUID v7)를 따르기 위해서다.
     */
    @Id
    @GeneratedUuidV7
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "group_id", nullable = false, updatable = false)
    private UUID groupId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /**
     * 여기까지 읽었다(<b>이 메시지 포함</b>). 안 읽음은 {@code id > last_read_message_id} 로 센다.
     *
     * <p>커서는 <b>뒤로 가지 않는다</b> — 갱신 UPSERT 의 {@code WHERE} 절이 「더 큰 값일 때만」으로
     * 막는다({@code ChatReadCursorRepository#upsertIfNewer}). 막지 않으면 옛 화면이 뒤늦게 보낸
     * 읽음 신호가 커서를 되돌려, 이미 읽은 말이 다시 안 읽음으로 부활한다.
     */
    @Column(name = "last_read_message_id", nullable = false)
    private UUID lastReadMessageId;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Builder
    private ChatReadCursor(UUID groupId, UUID userId, UUID lastReadMessageId, Instant updatedAt) {
        this.groupId = groupId;
        this.userId = userId;
        this.lastReadMessageId = lastReadMessageId;
        this.updatedAt = updatedAt;
    }

}

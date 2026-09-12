package com.oneorthree.realtime.message.repository;

import com.oneorthree.realtime.message.repository.domain.ChatReadCursor;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 읽음 커서 조회·저장. 자연키는 {@code (group_id, user_id)} 이고 DB 유니크 제약이 그걸 지킨다. */
public interface ChatReadCursorRepository extends JpaRepository<ChatReadCursor, UUID> {

    Optional<ChatReadCursor> findByGroupIdAndUserId(UUID groupId, UUID userId);

    /**
     * 커서를 <b>앞으로만</b> 옮긴다 — 없으면 만들고, 있으면 더 큰 값일 때만 갱신한다.
     *
     * <p>「읽어서 없으면 만들고 있으면 고친다」를 자바로 쓰지 않는 이유가 두 가지다.
     * <ol>
     *   <li><b>생성 경합</b> — 같은 사람이 두 기기에서 처음 방에 들어오면 두 요청이 둘 다 「없음」을
     *       읽고 둘 다 INSERT 해 유니크 위반이 난다. 그 예외를 잡아 재시도하는 코드는 트랜잭션이
     *       이미 롤백 표시된 상태라 다시 읽지도 못한다.</li>
     *   <li><b>역행</b> — 읽기와 쓰기 사이에 다른 요청이 더 앞으로 옮겨 두면, 이쪽의 옛 값이 그걸
     *       덮어 배지가 되살아난다.</li>
     * </ol>
     * {@code ON CONFLICT … DO UPDATE … WHERE} 한 문장이 둘 다 없앤다 — 조건이 DB 안에서 평가되므로
     * 읽기와 쓰기 사이에 창이 없다.
     *
     * <p>{@code WHERE} 절이 거짓이면(= 뒤로 가는 요청) 아무 행도 바뀌지 않고 <b>예외도 나지 않는다</b>.
     * 호출부는 그걸 정상으로 다룬다 — 「이미 더 읽었다」는 실패가 아니다.
     *
     * <p>{@code @Transactional} 이 <b>여기</b> 붙어 있다. {@code @Modifying} 네이티브 쿼리는 쓰기
     * 트랜잭션을 요구하는데(조회 계열과 달리 리포지토리 기본값이 열어 주지 않는다), 그걸 서비스에
     * 붙이면 관문의 Redis·HTTP 호출까지 트랜잭션 안으로 끌려 들어와 DB 커넥션을 쥔 채 네트워크를
     * 기다리게 된다. 문장 하나짜리 트랜잭션은 문장 옆에 두는 편이 좁다.
     *
     * @param id 새로 만들 때 쓸 PK. 갱신 경로에서는 무시된다 — 그래서 호출부가 매번 새 UUID v7 을
     *           만들어 넘겨도 기존 행의 id 는 바뀌지 않는다
     * @return 실제로 바뀐 행 수(0 또는 1)
     */
    @Transactional
    @Modifying
    @Query(value = """
            INSERT INTO chat_read_cursors (id, group_id, user_id, last_read_message_id, updated_at)
            VALUES (:id, :groupId, :userId, :lastReadMessageId, :now)
            ON CONFLICT (group_id, user_id) DO UPDATE
               SET last_read_message_id = EXCLUDED.last_read_message_id,
                   updated_at           = EXCLUDED.updated_at
             WHERE chat_read_cursors.last_read_message_id < EXCLUDED.last_read_message_id
            """, nativeQuery = true)
    int upsertIfNewer(@Param("id") UUID id,
            @Param("groupId") UUID groupId,
            @Param("userId") UUID userId,
            @Param("lastReadMessageId") UUID lastReadMessageId,
            @Param("now") Instant now);
}

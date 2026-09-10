package com.oneorthree.chat.message.repository;

import com.oneorthree.chat.message.repository.domain.ChatMessage;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 메시지 조회. <b>모든 정렬과 페이징이 {@code id} 의 시간 단조성(UUID v7)에 얹혀 있다.</b>
 *
 * <p>{@code sent_at} 으로 정렬하지 않는 이유는 같은 밀리초에 들어온 두 메시지의 순서가 정해지지
 * 않아 커서 페이징이 어긋나기 때문이다(같은 값이 경계에 걸리면 한 건이 두 페이지에 나오거나 빠진다).
 * id 는 유니크라 그 문제가 없다.
 */
public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {

    /**
     * 재전송 판정 — 유니크 제약에 걸린 뒤 «원래 그 메시지»를 찾아 돌려주기 위한 조회다.
     *
     * <p>넣기 전에 이걸로 검사하지 않는다. 그러면 검사와 INSERT 사이에 창이 생겨 동시 재전송이
     * 둘 다 통과한다 — 순서가 반대여야 한다(먼저 넣고, 제약에 걸리면 그때 찾는다).
     */
    Optional<ChatMessage> findByGroupIdAndSenderIdAndClientMessageId(UUID groupId, UUID senderId,
            UUID clientMessageId);

    /**
     * 최신부터 {@code pageable} 크기만큼. 방에 처음 들어갔을 때 쓴다.
     *
     * @return 최신 → 과거 순. 화면은 뒤집어 그린다
     */
    List<ChatMessage> findByGroupIdOrderByIdDesc(UUID groupId, Pageable pageable);

    /**
     * 커서보다 «과거»로 한 페이지 더. 위로 스크롤할 때 쓴다.
     *
     * @param cursor 이 id <b>미만</b>을 가져온다 — 경계 메시지를 다시 주지 않으려고 {@code <} 다.
     *               {@code <=} 로 바꾸면 페이지마다 한 건씩 겹쳐 화면에 중복이 생긴다
     */
    List<ChatMessage> findByGroupIdAndIdLessThanOrderByIdDesc(UUID groupId, UUID cursor, Pageable pageable);

    /**
     * 「이 메시지가 정말 이 섬의 것인가」 — 읽음 커서 갱신 전 검증에 쓴다.
     *
     * <p>id 만으로 찾지 않는 것이 핵심이다. 존재 여부만 보면 «다른 방의 메시지 id» 가 통과하고,
     * 그건 그 방의 커서를 남의 방 시간축으로 밀어 버린다.
     */
    boolean existsByIdAndGroupId(UUID id, UUID groupId);

    /** 방 목록의 「마지막 말」 미리보기. 그룹 하나짜리 조회라, 여러 방은 {@link #findLatestPerGroup} 을 쓴다. */
    Optional<ChatMessage> findFirstByGroupIdOrderByIdDesc(UUID groupId);

    /**
     * 여러 방의 마지막 메시지를 <b>한 번에</b>.
     *
     * <p>방마다 {@link #findFirstByGroupIdOrderByIdDesc} 를 부르면 방 수만큼 쿼리가 나간다(N+1).
     * Postgres 의 {@code DISTINCT ON} 은 정렬 첫 열의 그룹마다 첫 행을 남기므로 이 모양이 한 방에
     * 끝난다 — 표준 SQL 이 아니라 Postgres 전용이고, 이 서비스는 Postgres 만 쓴다.
     *
     * @param groupIds 빈 컬렉션이면 빈 결과다(호출부가 미리 걸러도 안전하게 동작한다)
     */
    @Query(value = """
            SELECT DISTINCT ON (m.group_id) m.*
            FROM chat_messages m
            WHERE m.group_id IN (:groupIds)
            ORDER BY m.group_id, m.id DESC
            """, nativeQuery = true)
    List<ChatMessage> findLatestPerGroup(@Param("groupIds") Collection<UUID> groupIds);

    /**
     * 방별 안 읽음 개수 — 읽음 커서 기준.
     *
     * <p>커서 테이블과 LEFT JOIN 해서 «커서가 아직 없는 방»(= 한 번도 안 들어간 방)은 전량을 안 읽음으로
     * 센다. 자기가 보낸 말은 뺀다 — 안 그러면 말할 때마다 자기 방의 배지가 오른다.
     *
     * <p>비교가 {@code m.id > c.last_read_message_id} 인 것이 핵심이다. Postgres 의 uuid 비교는
     * 바이트열 순서이고 v7 에서 그건 곧 시간 순서다({@code ChatReadCursor#advanceTo} 의 주석 참조).
     *
     * @return 안 읽음이 <b>1건 이상인 방만</b> 나온다 — 0건인 방은 행 자체가 없으므로 호출부가 0 으로 채운다
     */
    @Query(value = """
            SELECT m.group_id AS groupId, COUNT(*) AS unreadCount
            FROM chat_messages m
            LEFT JOIN chat_read_cursors c
                   ON c.group_id = m.group_id AND c.user_id = :userId
            WHERE m.group_id IN (:groupIds)
              AND m.sender_id <> :userId
              AND (c.last_read_message_id IS NULL OR m.id > c.last_read_message_id)
            GROUP BY m.group_id
            """, nativeQuery = true)
    List<UnreadCount> countUnreadPerGroup(@Param("groupIds") Collection<UUID> groupIds,
            @Param("userId") UUID userId);

    /** {@link #countUnreadPerGroup} 의 행 하나. 인터페이스 프로젝션이라 별칭 이름이 계약이다. */
    interface UnreadCount {
        UUID getGroupId();

        long getUnreadCount();
    }
}

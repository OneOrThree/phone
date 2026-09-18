package com.oneorthree.phone.letter.repository;

import com.oneorthree.phone.letter.repository.domain.Letter;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * 편지 조회·읽음 표시 (GROMO-1933).
 *
 * <p><b>모든 조회가 {@code deletedAt IS NULL} 을 건다.</b> 지금은 그 값을 채우는 쓰기 경로가 없지만
 * (LLD §4 결정 3 미결), 필터를 나중에 붙이는 방식은 「결정이 나자마자 이미 노출된 편지」를 만든다.
 *
 * <p>정렬·커서 축은 {@code id} 다 — UUID v7 이 이미 생성 시간순이라 별도 정렬 컬럼이 필요 없다
 * ({@code FocusSessionRepository.findSessionsByCursor} 선례와 같은 이유). {@code created_at} 으로
 * 정렬하면 같은 밀리초의 두 편지가 페이지 경계에서 중복·누락된다.
 */
public interface LetterRepository extends JpaRepository<Letter, UUID> {

    /**
     * 상세 조회용 — 발신자를 함께 로드한다({@code senderNickname} 이 응답에 실린다, LLD §1.14).
     * 수신자는 {@code receiver.id} 만 읽으므로 LAZY 프록시로 충분하다(추가 SELECT 가 나가지 않는다).
     *
     * @param id 편지 id
     * @return 살아 있는 편지 1건. empty 는 {@code LETTER_NOT_FOUND} 이고, 「내 것이 아님」과 구분하지 않는다
     *     — 구분해 주면 남의 편지 id 로 「그런 편지가 있는가」가 샌다
     */
    @Query("SELECT l FROM Letter l JOIN FETCH l.sender WHERE l.id = :id AND l.deletedAt IS NULL")
    Optional<Letter> findActiveWithSender(@Param("id") UUID id);

    /**
     * 받은 편지함 한 페이지 — 상대(발신자)를 함께 로드해 닉네임 N+1 을 막는다.
     *
     * @param userId   편지함 주인. 쿼리에 박혀 있어 남의 편지함을 가리킬 입력이 없다
     * @param cursor   직전 페이지의 마지막 편지 id. {@code null} 이면 첫 페이지
     * @param pageable size 만 쓴다 — 정렬은 쿼리에 박혀 있고 offset 은 커서가 대신한다
     * @return 최신순 한 페이지. {@code Slice} 라 count 쿼리가 나가지 않는다(편지함은 전체 개수를 안 쓴다)
     */
    @Query("SELECT l FROM Letter l JOIN FETCH l.sender "
            + "WHERE l.receiver.id = :userId AND l.deletedAt IS NULL "
            + "AND (:cursor IS NULL OR l.id < :cursor) "
            + "ORDER BY l.id DESC")
    Slice<Letter> findReceivedByCursor(@Param("userId") UUID userId,
                                       @Param("cursor") UUID cursor,
                                       Pageable pageable);

    /**
     * 보낸 편지함 한 페이지 — 상대(수신자)를 함께 로드한다. 조건이 {@code sender} 라는 점만 다르다.
     *
     * @param userId   편지함 주인
     * @param cursor   직전 페이지의 마지막 편지 id. {@code null} 이면 첫 페이지
     * @param pageable size 만 쓴다
     * @return 최신순 한 페이지
     */
    @Query("SELECT l FROM Letter l JOIN FETCH l.receiver "
            + "WHERE l.sender.id = :userId AND l.deletedAt IS NULL "
            + "AND (:cursor IS NULL OR l.id < :cursor) "
            + "ORDER BY l.id DESC")
    Slice<Letter> findSentByCursor(@Param("userId") UUID userId,
                                   @Param("cursor") UUID cursor,
                                   Pageable pageable);

    /**
     * 최초 열람 시각을 <b>원자적으로</b> 박는다 (LLD §1.14 부수효과).
     *
     * <p>읽고 나서 쓰면 두 기기·재시도가 동시에 {@code readAt IS NULL} 을 읽어 각자의 {@code now()} 를
     * 덮어써 실제 최초 열람 시각이 보존되지 않는다. 조건을 UPDATE 의 WHERE 에 두어 첫 갱신만 이기게 한다.
     *
     * @param id  편지 id
     * @param now 열람 시각
     * @return 갱신된 행 수 — {@code 1} 이면 이번 호출이 최초 열람이고, {@code 0} 이면 이미 읽은 편지다
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Letter l SET l.readAt = :now WHERE l.id = :id AND l.readAt IS NULL")
    int markReadIfUnread(@Param("id") UUID id, @Param("now") Instant now);
}

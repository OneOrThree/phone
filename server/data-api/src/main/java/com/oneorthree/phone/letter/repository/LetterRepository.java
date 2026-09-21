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
 * <p><b>모든 조회가 {@code deletedAt IS NULL} 을 건다.</b> GROMO-1933 이 이 필터를 «쓰는 경로가 없을 때»
 * 미리 걸어 둔 덕에, GROMO-2002 의 닫기·친구 삭제 정리는 쓰기 두 줄({@link #softDeleteIfActive} ·
 * {@link #softDeleteUnreadBetween})만 더하면 됐다 — 읽기는 한 줄도 고치지 않았다.
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
     * <p><b>{@code deletedAt IS NULL} 도 WHERE 에 있다</b> (codex 리뷰 P2). 없으면 «죽은 행에 쓴다» —
     * 한 기기가 상세를 연 사이 다른 기기의 {@link #softDeleteIfActive}(닫기)나 친구 삭제의
     * {@link #softDeleteUnreadBetween} 가 커밋되면, 이 UPDATE 가 행 잠금을 기다렸다가 <b>이미 소프트
     * 삭제된 행의 {@code readAt} 을 갱신</b>하고 호출측이 캐시한 본문을 200 으로 내보낸다. 즉
     * 「닫으면 양쪽에서 사라진다」(GROMO-2002)가 깨져 삭제된 편지를 계속 열람할 수 있다.
     * 조건이 있으면 READ COMMITTED 의 술어 재평가로 0 행이 되어 호출측이 404 로 돌린다.
     *
     * <p>⚠ <b>그래서 {@code 0} 의 뜻이 둘로 갈린다</b> — 「이미 읽었다」와 「삭제됐다」다. 반환값만으로는
     * 구분할 수 없으므로 <b>호출측이 {@link #findActiveWithSender} 로 되짚어 갈라야 한다</b>
     * ({@code InternalLetterService.markRead}): 살아 있으면 이미 읽은 것이고, 없으면 삭제된 것이다.
     * 여기서 두 사유를 합쳐 돌려주면 삭제된 편지가 「이미 읽음」으로 둔갑해 200 이 나간다.
     *
     * @param id  편지 id
     * @param now 열람 시각
     * @return 갱신된 행 수 — {@code 1} 이면 이번 호출이 최초 열람이다. {@code 0} 은 <b>이미 읽었거나
     *     그 사이 삭제됐다</b>는 뜻이라, 호출측이 활성 재조회로 두 사유를 갈라야 한다
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Letter l SET l.readAt = :now"
            + " WHERE l.id = :id AND l.readAt IS NULL AND l.deletedAt IS NULL")
    int markReadIfUnread(@Param("id") UUID id, @Param("now") Instant now);

    /**
     * 「닫기」 — 편지 한 통을 소프트 삭제한다 (GROMO-2002, policy-2026-09-14
     * 「받는 사람이 편지를 열었다가 닫으면 지워지고, 보낸 사람 목록에서도 사라진다」).
     *
     * <p>엔티티 setter 대신 조건부 벌크 UPDATE 인 이유는 {@link #markReadIfUnread} 와 같다:
     * {@code Letter} 에 {@code @Version} 도 {@code @DynamicUpdate} 도 없어 더티 체킹이 전 컬럼을
     * 덮어쓴다 — 다른 기기가 같은 순간 박은 {@code readAt} 을 되돌릴 수 있다. 한 컬럼만 건드린다.
     *
     * @param id  닫을 편지 id
     * @param now 삭제 시각
     * @return 갱신된 행 수. {@code 0} 이면 이미 닫혀 있었다 — 호출측이 404 로 옮긴다
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Letter l SET l.deletedAt = :now WHERE l.id = :id AND l.deletedAt IS NULL")
    int softDeleteIfActive(@Param("id") UUID id, @Param("now") Instant now);

    /**
     * 친구 삭제에 딸린 정리 (GROMO-2002, policy-2026-09-14 「친구를 삭제하면 서로 편지를 보낼 수 없고
     * <b>아직 확인하지 않은 편지도 지운다</b>」).
     *
     * <p><b>읽은 편지는 건드리지 않는다.</b> 「아직 확인하지 않은」이 정책 문구 그대로의 범위다 —
     * 이미 읽은 편지는 수신자가 닫아서 지우는 것이지 친구 삭제가 대신 지우지 않는다.
     *
     * <p>두 방향을 한 UPDATE 로 지운다 — 관계가 끊기면 양쪽 모두 못 보내게 되므로 방향을 나눌 이유가 없다.
     *
     * @param oneUserId     관계의 한쪽
     * @param otherUserId   관계의 다른 쪽
     * @param now           삭제 시각
     * @return 지운 행 수. {@code 0} 은 「주고받은 미확인 편지가 없었다」는 정상 결과다
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Letter l SET l.deletedAt = :now "
            + "WHERE l.deletedAt IS NULL AND l.readAt IS NULL "
            + "AND ((l.sender.id = :oneUserId AND l.receiver.id = :otherUserId) "
            + "  OR (l.sender.id = :otherUserId AND l.receiver.id = :oneUserId))")
    int softDeleteUnreadBetween(@Param("oneUserId") UUID oneUserId,
                                @Param("otherUserId") UUID otherUserId,
                                @Param("now") Instant now);
}

package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntent;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntentStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * claim 의도 큐 저장소 (A22 ㊄).
 *
 * <p>{@code eventId} 조회가 멱등의 축이다 — 같은 {@code (유저, slug)} 로 다시 들어온 의도는 새 행을
 * 만들지 않고 기존 행을 그대로 돌려줘야 한다. 새로 만들면 재개가 같은 귀속을 두 번 밟는다.
 *
 * <h2>락 등급이 계약이다 — 상태를 바꿀 조회는 {@code ...ForUpdate} 여야 한다</h2>
 * 이 행의 전이(lease · 완료 · 종결 · 확정에 의한 소비)는 전부 <b>「읽고 판정한 뒤 쓴다」</b> 꼴인데,
 * 이 엔티티에는 {@code @Version} 이 없고 기본 격리는 {@code READ COMMITTED} 다. 잠그지 않고 읽으면
 * 두 트랜잭션이 <b>같은 옛 상태를 보고 둘 다 판정을 통과</b>한다 — 동시 lease 둘이 모두
 * {@code leased=true} 를 받아 재개 실행자 둘이 같은 귀속을 밀고, 낡은 완료 보고가 그 사이 갱신된
 * 리스를 덮어(lost update) 아직 일하는 실행자의 의도를 끝난 것으로 만든다.
 *
 * <p>그래서 <b>전이 경로는 {@code PESSIMISTIC_WRITE} 조회만 쓴다</b>. 반대로 목록·건수처럼 아무것도
 * 바꾸지 않는 조회는 잠그지 않는다 — 재개 목록까지 잠그면 실행자 하나가 페이지 전체를 붙들어,
 * 정작 직렬화해야 할 것은 행 하나인데 큐 전체가 멈춘다.
 *
 * <p><b>락 순서</b>는 {@code aggregate_versions} → 이 행이다({@code confirmClaim} 이 그 순서로 잡는다).
 * 이 행을 잠근 뒤 aggregate 를 잡는 경로는 두지 않는다 — 그 순간 교착의 고리가 생긴다.
 */
public interface InviteClaimIntentRepository extends JpaRepository<InviteClaimIntent, UUID> {

    /**
     * 적재의 <b>무락</b> 빠른 경로 — 이미 적재된 의도를 그대로 재생할 뿐 상태를 바꾸지 않는다.
     * 상태를 바꿀 거면 {@link #findByEventIdForUpdate(String)} 를 써야 한다.
     *
     * @param eventId 결정적 사건 키
     * @return 이미 적재된 의도
     */
    Optional<InviteClaimIntent> findByEventId(String eventId);

    /**
     * 확정이 의도를 닫기 위한 <b>배타 잠금</b> 조회.
     *
     * <p>{@code consume} 은 현재 리스 토큰을 완료 토큰으로 물려받는다 — 그 토큰을 잠그지 않고 읽으면
     * 「방금 남이 재선점한 리스」의 토큰을 물려받거나, 반대로 재선점이 이 종결을 덮는다.
     *
     * @param eventId 결정적 사건 키
     * @return 잠긴 채로 돌아온 의도
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM InviteClaimIntent i WHERE i.eventId = :eventId")
    Optional<InviteClaimIntent> findByEventIdForUpdate(@Param("eventId") String eventId);

    /**
     * 선점·완료 보고가 쓰는 <b>배타 잠금</b> 조회 — 이 경로들은 서비스 전용이라 소유자 조건이 없다.
     *
     * <p>잠금이 곧 「동시 lease 중 하나만 {@code true}」와 「낡은 완료가 새 리스를 못 덮는다」의 근거다.
     * 무락 조회로 바꾸면 두 계약이 동시에, 그리고 <b>조용히</b> 깨진다(둘 다 성공 응답을 준다).
     *
     * @param id 의도 id
     * @return 잠긴 채로 돌아온 의도
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM InviteClaimIntent i WHERE i.id = :id")
    Optional<InviteClaimIntent> findByIdForUpdate(@Param("id") UUID id);

    /**
     * 소유자 자신이 종결할 때 쓰는 <b>배타 잠금</b> 조회.
     *
     * @param id     의도 id
     * @param userId 요청자 — <b>조건에 함께 넣는다</b>. 소유 검사를 조회 뒤로 미루면 남의 의도를
     *               「없음」이 아니라 「있음」으로 본 뒤 판정하게 되어 존재 여부가 응답으로 샌다
     * @return 잠긴 채로 돌아온 그 유저의 의도
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM InviteClaimIntent i WHERE i.id = :id AND i.userId = :userId")
    Optional<InviteClaimIntent> findByIdAndUserIdForUpdate(
            @Param("id") UUID id, @Param("userId") UUID userId);

    /**
     * @param userId 유저
     * @param status 상태
     * @return 재개 대상 목록 — 오래된 것부터
     */
    @Query("SELECT i FROM InviteClaimIntent i WHERE i.userId = :userId AND i.status = :status "
            + "ORDER BY i.createdAt ASC")
    List<InviteClaimIntent> findByUserIdAndStatus(
            @Param("userId") UUID userId, @Param("status") InviteClaimIntentStatus status);

    /**
     * @param status 상태
     * @return 그 상태의 전체 건수 — 인플라이트·백오프 대기분까지 포함한 「남은 것」의 유일한 척도다
     */
    long countByStatus(InviteClaimIntentStatus status);

    /**
     * 재개 실행자가 읽는 «집을 수 있는 것» — 커서 페이지네이션.
     *
     * <p>커서를 시각이 아니라 <b>id</b> 로 잡는다. PK 는 UUID v7 이라 시간 정렬이면서도 유일하므로,
     * 같은 밀리초에 여러 건이 커밋돼도 페이지 경계에서 행을 건너뛰거나 반복하지 않는다
     * ({@code createdAt} 커서는 둘 다 일어난다).
     *
     * <p><b>이 조회는 Data 안에 실행자를 만들지 않는다</b> — 링크 조회·claim 실행은 단방향 규칙(§3)
     * 위반이라 Data 가 할 수 없다. 여기서 주는 것은 상태뿐이고, 밟는 것은 Business 다.
     *
     * @param cursor 직전 페이지의 마지막 id. 첫 페이지는 {@code null}
     * @param now    현재 시각 — 백오프·리스 만료 판정 기준
     * @param limit  최대 건수
     * @return 선점 가능한 대기 의도
     */
    @Query(value = "SELECT * FROM invite_claim_intents i WHERE i.status = 'PENDING' "
            + "AND (:cursor IS NULL OR i.id > CAST(:cursor AS uuid)) "
            + "AND i.next_attempt_at <= :now "
            + "AND (i.lease_expires_at IS NULL OR i.lease_expires_at <= :now) "
            + "ORDER BY i.id ASC LIMIT :limit", nativeQuery = true)
    List<InviteClaimIntent> findClaimable(
            @Param("cursor") String cursor, @Param("now") Instant now, @Param("limit") int limit);
}

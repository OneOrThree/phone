package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntent;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntentStatus;
import org.springframework.data.jpa.repository.JpaRepository;
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
 */
public interface InviteClaimIntentRepository extends JpaRepository<InviteClaimIntent, UUID> {

    /**
     * @param eventId 결정적 사건 키
     * @return 이미 적재된 의도
     */
    Optional<InviteClaimIntent> findByEventId(String eventId);

    /**
     * @param id     의도 id
     * @param userId 요청자 — <b>조건에 함께 넣는다</b>. 소유 검사를 조회 뒤로 미루면 남의 의도를
     *               「없음」이 아니라 「있음」으로 본 뒤 판정하게 되어 존재 여부가 응답으로 샌다
     * @return 그 유저의 의도
     */
    Optional<InviteClaimIntent> findByIdAndUserId(UUID id, UUID userId);

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
    /**
     * @param status 상태
     * @return 그 상태의 전체 건수 — 인플라이트·백오프 대기분까지 포함한 「남은 것」의 유일한 척도다
     */
    long countByStatus(InviteClaimIntentStatus status);

    @Query(value = "SELECT * FROM invite_claim_intents i WHERE i.status = 'PENDING' "
            + "AND (:cursor IS NULL OR i.id > CAST(:cursor AS uuid)) "
            + "AND i.next_attempt_at <= :now "
            + "AND (i.lease_expires_at IS NULL OR i.lease_expires_at <= :now) "
            + "ORDER BY i.id ASC LIMIT :limit", nativeQuery = true)
    List<InviteClaimIntent> findClaimable(
            @Param("cursor") String cursor, @Param("now") Instant now, @Param("limit") int limit);
}

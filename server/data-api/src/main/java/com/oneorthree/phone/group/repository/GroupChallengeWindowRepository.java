package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * {@code type=TIME_WINDOW} 챌린지 상세(CTI) 조회. PK 가 challenge_id 라 단건은 {@code findById(challengeId)}
 * 로 바로 집는다. <b>상세 행의 존재 자체가 창형이라는 뜻</b>이고, 챌린지를 소프트 삭제해도 이 행은 남는다.
 */
public interface GroupChallengeWindowRepository extends JpaRepository<GroupChallengeWindow, UUID> {

    /**
     * 여러 챌린지의 창 상세를 한 번에 붙이는 배치 로드 — 챌린지마다 따로 읽으면 N+1 이 된다.
     *
     * @param challengeIds 상세를 붙일 챌린지 id 들. 창형이 아닌 id 가 섞여도 무해하다(결과에서 빠질 뿐)
     * @return 존재하는 상세만 — <b>요청 수보다 적을 수 있다</b>. 하루형이거나 상세가 유실된 구 데이터는
     *     빠지므로 호출측은 id 로 맵을 만들어 결손을 "판정 불가"로 다뤄야 한다. 삭제된 챌린지의 상세도
     *     그대로 실린다(이 쿼리는 {@code deletedAt} 을 보지 않는다)
     */
    List<GroupChallengeWindow> findByChallengeIdIn(Collection<UUID> challengeIds);

    /**
     * 그룹의 ACTIVE 창형 상세를 배타 락(SELECT … FOR UPDATE)으로 읽는다 — 창형 생성의 겹침
     * 검사(CHALLENGE_WINDOW_OVERLAP)를 동시 생성·삭제와 직렬화하기 위한 것이다(deleteChallenge 의
     * 챌린지 행 락 관행 재사용). 창형은 겹치지만 않으면 카테고리 무관하게 여럿 존재할 수 있으므로
     * (FR-3 · GROMO-1422 로 V20 부분 유니크가 하루형에만 남았다) 행 수는 활성 상한(4)까지 늘어난다.
     *
     * <p><b>{@code JOIN FETCH}</b> 인 이유(GROMO-1270): 겹침 판정이 요일 교집합까지 보게 되면서
     * 부모 챌린지의 {@code repeatDays} 를 함께 읽어야 한다. LAZY 프록시를 루프에서 깨우면 행마다
     * 추가 쿼리(N+1)가 나간다 — 활성 상한 4행이면 최대 4번이다. 같은 쿼리에서 부모 컬럼까지
     * 끌어오면 왕복이 사라진다.
     *
     * <p>⚠️ <b>이건 성능 이유지 정합성 구멍을 막는 게 아니다.</b> 종전 주석은 "지연 로딩은
     * {@code FOR UPDATE} 밖의 별도 스냅샷이라 다른 값을 읽는다"고 적었는데 과장이다. 근거는
     * 잠금 범위가 아니라 <b>{@code repeatDays} 의 불변성</b>이다 — 생성 이후 갱신 경로 자체가
     * 없다(챌린지 수정 API 없음). 잠금이 어디까지 걸리든 값이 변할 수 없다. 게다가 이 변경
     * 이전에도 {@code WHERE} 가 {@code c.status}·{@code c.deletedAt} 을 읽고 있었으므로
     * {@code JOIN} → {@code JOIN FETCH} 는 <b>읽는 대상을 늘리지도 줄이지도 않는다.</b>
     *
     * <p>⚠️ <b>부모 행이 실제로 잠기는지는 확인하지 못했다 — 어느 쪽으로도 단정하지 마라.</b>
     * {@code @Lock(PESSIMISTIC_WRITE)} 의 JPA 계약({@code PessimisticLockScope.NORMAL})은
     * 조회 루트에만 걸린다. Hibernate 가 alias 없이 {@code FOR UPDATE} 를 내면 PostgreSQL 은
     * 문장의 모든 테이블을 잠그지만, {@code FOR ... OF <alias>} 로 내면 루트만 잠근다.
     * 발행 SQL 확인을 두 번 시도했으나 {@code logback-spring.xml} 의 {@code <root level="INFO">}
     * 가 {@code org.hibernate.SQL} DEBUG 를 삼켜 실패했다. 동시 {@code endChallenge}/
     * {@code deleteChallenge} 와의 직렬화를 논하려면 <b>먼저 발행 SQL 을 볼 것</b>.
     * 근거 없는 "이 변경이 경합을 고쳤다"는 서술을 남기면 다음 사람이 있지도 않은 레이스를
     * 전제로 코드를 짠다(리뷰 지적 ×2).
     *
     * <p>겹침 판정 자체는 KST 벽시계 시각(time-of-day)과 요일 비트 연산이라 SQL 이 아니라
     * 서비스({@code GroupChallengeService})에서 한다. window 상세 행 존재 자체가 type=TIME_WINDOW
     * 를 의미하고(CTI), 삭제된 챌린지의 상세 행은 남아 있으므로 c.deletedAt IS NULL 을 빼면
     * 삭제한 시간대와 겹치는 창을 다시 못 만든다.
     *
     * @param group 겹침을 검사할 그룹 — 겹침은 그룹 전역 불변식이라 검사 단위가 챌린지가 아니라 그룹이다
     * @return 그 그룹의 살아 있는 창형 상세 전량(부모 챌린지가 함께 로드된 상태). 활성 상한이 4라
     *     최대 4행이고, 빈 리스트면 겹칠 대상이 없다는 뜻이다. 조회 중 다른 트랜잭션이 같은 행을
     *     쥐고 있으면 <b>대기</b>한다. readOnly 트랜잭션에서는 쓸 수 없다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM GroupChallengeWindow w"
            + " JOIN FETCH w.challenge c"
            + " WHERE c.group = :group"
            + " AND c.status = 'ACTIVE'"
            + " AND c.deletedAt IS NULL")
    List<GroupChallengeWindow> findActiveByGroupForUpdate(@Param("group") Group group);
}

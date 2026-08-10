package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface GroupChallengeWindowRepository extends JpaRepository<GroupChallengeWindow, UUID> {

    List<GroupChallengeWindow> findByChallengeIdIn(Collection<UUID> challengeIds);

    /**
     * 그룹의 ACTIVE 창형 상세를 배타 락(SELECT … FOR UPDATE)으로 읽는다 — 창형 생성의 겹침
     * 검사(CHALLENGE_WINDOW_OVERLAP)를 동시 생성·삭제와 직렬화하기 위한 것이다(deleteChallenge 의
     * 챌린지 행 락 관행 재사용). 창형은 겹치지만 않으면 카테고리 무관하게 여럿 존재할 수 있으므로
     * (FR-3 · GROMO-1422 로 V20 부분 유니크가 하루형에만 남았다) 행 수는 활성 상한(4)까지 늘어난다.
     *
     * <p><b>{@code JOIN FETCH}</b> 인 이유(GROMO-1270): 겹침 판정이 요일 교집합까지 보게 되면서
     * 부모 챌린지의 {@code repeatDays} 를 함께 읽어야 한다. LAZY 프록시를 루프에서 깨우면 행마다
     * 추가 쿼리(N+1)가 나가고, 그 쿼리는 이 {@code FOR UPDATE} 밖의 별도 스냅샷이라 잠근 것과
     * 다른 값을 읽을 수 있다. 같은 잠긴 쿼리에서 부모 컬럼까지 끌어오면 둘 다 사라진다.
     *
     * <p>겹침 판정 자체는 KST 벽시계 시각(time-of-day)과 요일 비트 연산이라 SQL 이 아니라
     * 서비스({@code GroupChallengeService})에서 한다. window 상세 행 존재 자체가 type=TIME_WINDOW
     * 를 의미하고(CTI), 삭제된 챌린지의 상세 행은 남아 있으므로 c.deletedAt IS NULL 을 빼면
     * 삭제한 시간대와 겹치는 창을 다시 못 만든다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM GroupChallengeWindow w"
            + " JOIN FETCH w.challenge c"
            + " WHERE c.group = :group"
            + " AND c.status = 'ACTIVE'"
            + " AND c.deletedAt IS NULL")
    List<GroupChallengeWindow> findActiveByGroupForUpdate(@Param("group") Group group);
}

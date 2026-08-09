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
     * 그룹의 ACTIVE 창형 상세를 배타 락(SELECT … FOR UPDATE)으로 읽는다 — 창형 생성의 시간대 겹침
     * 검사(CHALLENGE_WINDOW_OVERLAP)를 동시 생성·삭제와 직렬화하기 위한 것이다(deleteChallenge 의
     * 챌린지 행 락 관행 재사용). 활성 창형은 카테고리×타입당 1개(V20 부분 유니크)라 최대 2행이다.
     *
     * <p>겹침 판정 자체는 KST 시각(time-of-day) 기준이라 SQL 이 아니라
     * 서비스({@code GroupChallengeService})에서 한다. window 상세 행 존재 자체가 type=TIME_WINDOW
     * 를 의미하고(CTI), 삭제된 챌린지의 상세 행은 남아 있으므로 c.deletedAt IS NULL 을 빼면
     * 삭제한 시간대와 겹치는 창을 다시 못 만든다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM GroupChallengeWindow w"
            + " JOIN w.challenge c"
            + " WHERE c.group = :group"
            + " AND c.status = 'ACTIVE'"
            + " AND c.deletedAt IS NULL")
    List<GroupChallengeWindow> findActiveByGroupForUpdate(@Param("group") Group group);
}

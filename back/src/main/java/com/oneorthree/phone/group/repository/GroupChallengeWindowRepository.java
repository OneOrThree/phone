package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface GroupChallengeWindowRepository extends JpaRepository<GroupChallengeWindow, UUID> {

    List<GroupChallengeWindow> findByChallengeIdIn(Collection<UUID> challengeIds);

    // 동일 그룹·카테고리의 ACTIVE TIME_WINDOW 챌린지와 [start, end) 가 겹치는지 (맞닿음(끝==시작)은 허용).
    // window 상세 행 존재 자체가 type=TIME_WINDOW 를 의미하므로(CTI) 별도 type 조건은 두지 않는다.
    @Query("SELECT COUNT(w) > 0 FROM GroupChallengeWindow w"
            + " JOIN w.challenge c"
            + " WHERE c.group = :group"
            + " AND c.category = :category"
            + " AND c.status = 'ACTIVE'"
            + " AND w.windowStartAt < :end"
            + " AND w.windowEndAt > :start")
    boolean existsOverlappingTimeWindow(
            @Param("group") Group group,
            @Param("category") MissionCategory category,
            @Param("start") Instant start,
            @Param("end") Instant end);
}

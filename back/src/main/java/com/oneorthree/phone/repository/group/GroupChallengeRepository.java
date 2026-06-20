package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupChallenge;
import com.oneorthree.phone.domain.group.GroupChallengeStatus;
import com.oneorthree.phone.domain.group.MissionCategory;
import com.oneorthree.phone.domain.group.MissionType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface GroupChallengeRepository extends JpaRepository<GroupChallenge, Long> {

    // TODO GROMO-375: 그룹 소속 검증용 조회 메서드 추가
    //  - Optional<GroupChallenge> findByIdAndGroup(Long id, Group group)
    //  - challengeId가 다른 그룹 챌린지면 비어있게 반환 → 서비스에서 NOT_FOUND 처리

    List<GroupChallenge> findByGroupOrderByCreatedAtDesc(Group group);

    boolean existsByGroupAndMissionCategoryAndMissionTypeAndStatus(
            Group group, MissionCategory category, MissionType type, GroupChallengeStatus status);

    @Query("SELECT COUNT(c) > 0 FROM GroupChallenge c"
            + " WHERE c.group = :group"
            + " AND c.missionCategory = :category"
            + " AND c.missionType = 'TIME_WINDOW'"
            + " AND c.status = 'ACTIVE'"
            + " AND c.windowStart < :end"
            + " AND c.windowEnd > :start")
    boolean existsOverlappingTimeWindow(
            @Param("group") Group group,
            @Param("category") MissionCategory category,
            @Param("start") Instant start,
            @Param("end") Instant end);
}

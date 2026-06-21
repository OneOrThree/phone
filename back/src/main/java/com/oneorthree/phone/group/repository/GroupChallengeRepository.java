package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface GroupChallengeRepository extends JpaRepository<GroupChallenge, Long> {

    Optional<GroupChallenge> findByIdAndGroup(Long id, Group group);

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

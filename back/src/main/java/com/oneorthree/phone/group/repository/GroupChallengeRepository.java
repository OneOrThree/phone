package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupChallengeRepository extends JpaRepository<GroupChallenge, UUID> {

    Optional<GroupChallenge> findByIdAndGroup(UUID id, Group group);

    List<GroupChallenge> findByGroupOrderByCreatedAtDesc(Group group);

    // GROMO-674: 그룹 대표 챌린지(가장 오래된 ACTIVE, 미삭제) — 그룹 상세/오버뷰의 미션 정보 소스.
    // 창설 시점 미션(구 groups.mission_*)의 의미 보존을 위해 최신이 아니라 최초 ACTIVE 를 대표로 삼는다
    // — 이후 챌린지가 추가돼도 대표 미션이 흔들리지 않음 (PR #173 리뷰).
    Optional<GroupChallenge> findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(
            Group group, GroupChallengeStatus status);

    boolean existsByGroupAndCategoryAndTypeAndStatus(
            Group group, MissionCategory category, MissionType type, GroupChallengeStatus status);

    // TIME_WINDOW 겹침 판정은 window 컬럼의 상세 테이블 분리에 따라
    // GroupChallengeWindowRepository.existsOverlappingTimeWindow 로 이동.
}

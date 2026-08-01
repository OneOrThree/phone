package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface GroupRepository extends JpaRepository<Group, UUID> {

    List<Group> findByStatus(GroupStatus status);

    // GROMO-676: groups.host_id 폐기 — 방장 여부는 group_members.role=OWNER 기준으로 판단한다.
    @Query("select count(gm) > 0 from GroupMember gm "
            + "where gm.user.id = :userId and gm.role = com.oneorthree.phone.group.domain.GroupMemberRole.OWNER")
    boolean existsGroupOwnedBy(@Param("userId") UUID userId);

    // 공개 그룹 이름 trgm fuzzy 검색. 비공개(is_private)·삭제 그룹은 제외한다.
    // 전제: pg_trgm 확장(V1) + groups.is_private(V17) + groups.name GIN trgm 인덱스(V18).
    // % = 트라이그램 유사도 매칭, <-> = 거리(가까운 순). 임계값(기본 0.3)은 닉네임 검색과 함께만 조정한다.
    @Query(value = "SELECT * FROM groups g"
            + " WHERE g.name % :q AND g.is_private = false AND g.deleted_at IS NULL"
            + " ORDER BY g.name <-> :q"
            + " LIMIT :limit", nativeQuery = true)
    List<Group> searchPublicByNameTrgm(@Param("q") String q, @Param("limit") int limit);
}

package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupRepository extends JpaRepository<Group, UUID> {

    List<Group> findByStatus(GroupStatus status);

    Optional<Group> findByCode(String code);

    // GROMO-676: groups.host_id 폐기 — 방장 여부는 group_members.role=OWNER 기준으로 판단한다.
    @Query("select count(gm) > 0 from GroupMember gm "
            + "where gm.user.id = :userId and gm.role = com.oneorthree.phone.group.domain.GroupMemberRole.OWNER")
    boolean existsGroupOwnedBy(@Param("userId") UUID userId);

    // GROMO-676 호환용 별칭 — user 도메인 호출부(UserService)가 existsGroupOwnedBy 로 교체되면 제거한다.
    default boolean existsByHostId(UUID userId) {
        return existsGroupOwnedBy(userId);
    }

    boolean existsByCode(String code);

    List<Group> findByNameContainingIgnoreCase(String name);
}

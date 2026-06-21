package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupRepository extends JpaRepository<Group, UUID> {

    List<Group> findByStatus(GroupStatus status);

    Optional<Group> findByCode(String code);

    boolean existsByHostId(UUID hostId);

    boolean existsByCode(String code);

    List<Group> findByNameContainingIgnoreCase(String name);
}

package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupStatus;
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

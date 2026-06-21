package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.domain.group.GroupStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GroupRepository extends JpaRepository<Group, Long> {

    List<Group> findByStatus(GroupStatus status);

    Optional<Group> findByCode(String code);

    boolean existsByHostId(Long hostId);

    boolean existsByCode(String code);

    List<Group> findByNameContainingIgnoreCase(String name);
}

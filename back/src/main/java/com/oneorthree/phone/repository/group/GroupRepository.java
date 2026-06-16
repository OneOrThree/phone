package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface GroupRepository extends JpaRepository<Group, Long> {

    List<Group> findByStatus(GroupStatus status);

    boolean existsByHostId(Long hostId);
}

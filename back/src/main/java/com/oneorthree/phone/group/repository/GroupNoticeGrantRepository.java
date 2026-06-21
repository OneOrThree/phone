package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupNoticeGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;
import java.util.UUID;

public interface GroupNoticeGrantRepository extends JpaRepository<GroupNoticeGrant, UUID> {

    List<GroupNoticeGrant> findByGroup(Group group);

    @Modifying
    void deleteByGroup(Group group);

    boolean existsByGroupAndUserId(Group group, UUID userId);
}

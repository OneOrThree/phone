package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupNoticeGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;

public interface GroupNoticeGrantRepository extends JpaRepository<GroupNoticeGrant, Long> {

    List<GroupNoticeGrant> findByGroup(Group group);

    @Modifying
    void deleteByGroup(Group group);

    boolean existsByGroupAndUserId(Group group, Long userId);
}

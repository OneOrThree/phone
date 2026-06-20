package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.GroupNoticeGrant;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GroupNoticeGrantRepository extends JpaRepository<GroupNoticeGrant, Long> {
    // TODO GROMO-378: 메서드 추가 (import: Group, Modifying, List)
    //  - List<GroupNoticeGrant> findByGroup(Group group)
    //  - @Modifying void deleteByGroup(Group group)
    //  - boolean existsByGroupAndUserId(Group group, Long userId)
}

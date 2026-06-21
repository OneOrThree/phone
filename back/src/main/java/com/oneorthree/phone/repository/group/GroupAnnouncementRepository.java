package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupAnnouncement;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface GroupAnnouncementRepository extends JpaRepository<GroupAnnouncement, UUID> {

    List<GroupAnnouncement> findByGroupOrderByCreatedAtDesc(Group group);
}

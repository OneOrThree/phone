package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupAnnouncement;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupAnnouncementRepository extends JpaRepository<GroupAnnouncement, UUID> {

    List<GroupAnnouncement> findByGroupOrderByCreatedAtDesc(Group group);

    Optional<GroupAnnouncement> findByIdAndGroup(UUID id, Group group);
}

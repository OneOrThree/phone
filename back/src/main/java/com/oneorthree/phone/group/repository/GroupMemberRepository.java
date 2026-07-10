package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupMemberRepository extends JpaRepository<GroupMember, UUID> {

    @EntityGraph(attributePaths = "user")
    List<GroupMember> findByGroup(Group group);

    List<GroupMember> findByUser(User user);

    Optional<GroupMember> findByUserAndGroup(User user, Group group);

}

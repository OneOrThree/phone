package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupInvite;
import com.oneorthree.phone.group.domain.GroupInviteStatus;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GroupInviteRepository extends JpaRepository<GroupInvite, Long> {

    List<GroupInvite> findByInviteeAndStatus(User invitee, GroupInviteStatus status);

    Optional<GroupInvite> findByGroupAndInvitee(Group group, User invitee);
}

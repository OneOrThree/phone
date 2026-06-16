package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupInvite;
import com.oneorthree.phone.domain.group.GroupInviteStatus;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GroupInviteRepository extends JpaRepository<GroupInvite, Long> {

    List<GroupInvite> findByInviteeAndStatus(User invitee, GroupInviteStatus status);

    Optional<GroupInvite> findByGroupAndInvitee(Group group, User invitee);
}

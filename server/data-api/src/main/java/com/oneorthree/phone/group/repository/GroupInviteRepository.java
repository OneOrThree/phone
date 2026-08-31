package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupInvite;
import com.oneorthree.phone.group.repository.domain.GroupInviteStatus;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 미사용 — 유저 직접 초대 기능을 접었고, 참여는 초대 링크(groupId)가 담당한다(2026-07-31).
 * 서비스·컨트롤러 참조 0건. 삭제하지 않는 이유는 참가 코드 체계와 같다(잔존 비용 &lt; 삭제 비용).
 */
public interface GroupInviteRepository extends JpaRepository<GroupInvite, UUID> {

    List<GroupInvite> findByInviteeAndStatus(User invitee, GroupInviteStatus status);

    Optional<GroupInvite> findByGroupAndInvitee(Group group, User invitee);
}

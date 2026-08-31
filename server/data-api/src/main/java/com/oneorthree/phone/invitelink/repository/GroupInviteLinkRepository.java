package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface GroupInviteLinkRepository extends JpaRepository<GroupInviteLink, UUID> {

    /** 멱등 발급의 조회 경로 — (그룹, 초대자)당 링크는 1개다. */
    Optional<GroupInviteLink> findByGroupIdAndInviterId(UUID groupId, UUID inviterId);

    Optional<GroupInviteLink> findBySlug(String slug);

    boolean existsBySlug(String slug);
}

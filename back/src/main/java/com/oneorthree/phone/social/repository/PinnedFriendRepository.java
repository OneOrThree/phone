package com.oneorthree.phone.social.repository;

import com.oneorthree.phone.social.domain.PinnedFriend;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PinnedFriendRepository extends JpaRepository<PinnedFriend, UUID> {

    // 멱등 핀 설정 — 이미 핀돼 있으면 재insert 하지 않음.
    boolean existsByUserAndFriendUser(User user, User friendUser);

    // 핀 해제 — 있으면 삭제, 없으면 멱등(no-op).
    Optional<PinnedFriend> findByUserAndFriendUser(User user, User friendUser);

    // 내가 핀한 친구 전체 (조회 / getFriends isPinned 배선).
    List<PinnedFriend> findByUser(User user);
}

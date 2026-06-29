package com.oneorthree.phone.friend.repository;

import com.oneorthree.phone.friend.domain.PinnedFriend;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PinnedFriendRepository extends JpaRepository<PinnedFriend, UUID> {

    // 멱등 핀 설정 — DB 차원 upsert. check-then-insert 경합(동시 요청) 시에도 500 없이 무시.
    // (JPA save는 commit 시점 flush라 try-catch로 못 잡고, 잡아도 트랜잭션이 rollback-only가 됨)
    @Modifying
    @Query(value = "INSERT INTO pinned_friend (id, user_id, friend_user_id, created_at) "
            + "VALUES (:id, :userId, :friendUserId, now()) ON CONFLICT DO NOTHING", nativeQuery = true)
    void insertIgnoreConflict(@Param("id") UUID id,
                              @Param("userId") UUID userId,
                              @Param("friendUserId") UUID friendUserId);

    // 핀 해제 — 있으면 삭제, 없으면 멱등(no-op).
    Optional<PinnedFriend> findByUserAndFriendUser(User user, User friendUser);

    // 내가 핀한 친구 전체 (조회 / getFriends isPinned 배선). friendUser fetch로 N+1 방지.
    @EntityGraph(attributePaths = "friendUser")
    List<PinnedFriend> findByUser(User user);
}

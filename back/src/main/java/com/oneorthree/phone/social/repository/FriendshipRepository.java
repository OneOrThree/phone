package com.oneorthree.phone.social.repository;

import com.oneorthree.phone.social.domain.Friendship;
import com.oneorthree.phone.social.domain.FriendshipStatus;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FriendshipRepository extends JpaRepository<Friendship, UUID> {

    // 보낸 요청 목록 (sent) — 예: findByFromUserAndStatus(me, PENDING)
    List<Friendship> findByFromUserAndStatus(User fromUser, FriendshipStatus status);

    // 받은 요청 목록 (received) — 예: findByToUserAndStatus(me, PENDING)
    List<Friendship> findByToUserAndStatus(User toUser, FriendshipStatus status);

    // 방향 고정 단건 조회 — REJECTED → PENDING 재전환 시 (me→target) row 특정용
    Optional<Friendship> findByFromUserAndToUser(User fromUser, User toUser);

    boolean existsByFromUserAndToUser(User fromUser, User toUser);

    // 두 유저 사이 페어 양방향 조회 — (a→b) / (b→a) 모두 포함.
    // createRequest 의 중복·이미친구·REJECTED 재전환 판정용 (정렬: 최신 updatedAt 우선).
    @Query("SELECT f FROM Friendship f"
            + " WHERE (f.fromUser = :a AND f.toUser = :b)"
            + " OR (f.fromUser = :b AND f.toUser = :a)"
            + " ORDER BY f.updatedAt DESC")
    List<Friendship> findPair(@Param("a") User a, @Param("b") User b);

    // 단일 ACCEPTED 친구 관계 양방향 단건 조회 (deletedAt IS NULL) — deleteFriend 용.
    @Query("SELECT f FROM Friendship f"
            + " WHERE f.status = 'ACCEPTED'"
            + " AND f.deletedAt IS NULL"
            + " AND ((f.fromUser = :me AND f.toUser = :friend)"
            + " OR (f.fromUser = :friend AND f.toUser = :me))")
    Optional<Friendship> findAcceptedBetween(@Param("me") User me, @Param("friend") User friend);

    // 내 친구 목록 — ACCEPTED, 미삭제, 내가 from 또는 to인 모든 관계 (getFriends 용).
    @Query("SELECT f FROM Friendship f"
            + " WHERE f.status = 'ACCEPTED'"
            + " AND f.deletedAt IS NULL"
            + " AND (f.fromUser = :me OR f.toUser = :me)")
    List<Friendship> findAcceptedByUser(@Param("me") User me);
}

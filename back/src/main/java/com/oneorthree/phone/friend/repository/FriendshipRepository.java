package com.oneorthree.phone.friend.repository;

import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FriendshipRepository extends JpaRepository<Friendship, UUID> {

    // 보낸 요청 목록 (sent) — 예: findByFromUserAndStatusAndDeletedAtIsNull(me, PENDING)
    // deletedAt 조건은 탈퇴자 정리분 제외용 (GROMO-801) — 아래 findByToUser… 와 같은 이유.
    List<Friendship> findByFromUserAndStatusAndDeletedAtIsNull(User fromUser, FriendshipStatus status);

    // 받은 요청 목록 (received) — 예: findByToUserAndStatusAndDeletedAtIsNull(me, PENDING)
    // 탈퇴 시 PENDING 요청도 deletedAt 이 찍히는데(GROMO-801), 이 목록만 status 파생 조회라
    // deletedAt 을 안 보면 탈퇴자 요청이 그대로 노출되고 수락 시 유령 친구가 생긴다.
    List<Friendship> findByToUserAndStatusAndDeletedAtIsNull(User toUser, FriendshipStatus status);

    // 방향 고정 단건 조회 — REJECTED → PENDING 재전환 시 (me→target) row 특정용
    Optional<Friendship> findByFromUserAndToUser(User fromUser, User toUser);

    // 요청 수락·거절 대상 단건 (GROMO-801) — 목록에서 숨긴 행은 변경도 막아야 계약이 일치한다.
    // 화면을 열어둔 사이 발신자가 탈퇴하면 클라가 들고 있던 requestId 로 수락을 호출할 수 있는데,
    // deletedAt 을 안 보면 200 + FRIEND_ADDED 이벤트가 나가고도 친구 목록엔 안 나타난다
    // (findAcceptedByUser 는 deletedAt IS NULL 이므로).
    Optional<Friendship> findByIdAndDeletedAtIsNull(UUID id);

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

    // 친구 수 카운트 — ACCEPTED, 미삭제, from·to 양방향 (공개 프로필 집계용).
    @Query("SELECT COUNT(f) FROM Friendship f"
            + " WHERE f.status = 'ACCEPTED'"
            + " AND f.deletedAt IS NULL"
            + " AND (f.fromUser = :me OR f.toUser = :me)")
    long countAcceptedByUser(@Param("me") User me);

    // 회원 탈퇴 정리 대상 — 내가 낀 미삭제 관계 전부, status 무관 (GROMO-801).
    // ACCEPTED(친구)뿐 아니라 PENDING(대기 중 요청)까지 걷어야 탈퇴자 요청이 상대 목록에 남지 않는다.
    // 벌크 UPDATE 대신 엔티티를 로드해 Friendship.softDelete() 를 태운다 — deletedAt 을 쓰는 통로를
    // 도메인 메서드 하나로 유지하기 위해서다. (현재 withdraw() 안에서는 벌크를 써도 깨지지 않는다:
    // 이 트랜잭션이 Friendship 을 다시 읽지 않아 1차 캐시 stale 이 실현되지 않는다. 다만 나중에
    // 같은 트랜잭션에서 Friendship 을 읽는 코드가 붙으면 그때 조용히 깨지므로 선제적으로 막아둔다.)
    // 탈퇴 1회당 많아야 수백 건이라 건별 처리 비용은 무의미하다.
    // 주의: friendships 에는 UNIQUE(from_user_id, to_user_id) 뿐이라 to_user_id 단독 인덱스가 없다.
    // 아래 OR 의 to_user_id 브랜치는 인덱스를 못 탄다 — findAcceptedByUser 등 기존 OR 조회와 동일한 특성.
    @Query("SELECT f FROM Friendship f"
            + " WHERE f.deletedAt IS NULL"
            + " AND (f.fromUser.id = :userId OR f.toUser.id = :userId)")
    List<Friendship> findActiveByUserId(@Param("userId") UUID userId);
}

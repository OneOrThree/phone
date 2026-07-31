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
    // 엔티티로 로드해 Friendship.softDelete() 를 태우는 이유는 벌크 @Modifying 이 영속성 컨텍스트를
    // 우회해(1차 캐시 stale) 도메인 메서드·라이프사이클을 건너뛰기 때문 — 탈퇴 1회당 많아야 수백 건이라
    // 건별 처리 비용이 무의미하다.
    @Query("SELECT f FROM Friendship f"
            + " WHERE f.deletedAt IS NULL"
            + " AND (f.fromUser.id = :userId OR f.toUser.id = :userId)")
    List<Friendship> findActiveByUserId(@Param("userId") UUID userId);
}

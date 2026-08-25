package com.oneorthree.phone.friend.repository;

import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public interface FriendshipRepository extends JpaRepository<Friendship, UUID> {

    /**
     * 보낸 요청 목록 (sent) — 예: findByFromUserAndStatusAndDeletedAtIsNull(me, PENDING)
     * deletedAt 조건은 탈퇴자 정리분 제외용 (GROMO-801) — 아래 findByToUser… 와 같은 이유.
     */
    List<Friendship> findByFromUserAndStatusAndDeletedAtIsNull(User fromUser, FriendshipStatus status);

    /**
     * 받은 요청 목록 (received) — 예: findByToUserAndStatusAndDeletedAtIsNull(me, PENDING)
     * 탈퇴 시 PENDING 요청도 deletedAt 이 찍히는데(GROMO-801), 이 목록만 status 파생 조회라
     * deletedAt 을 안 보면 탈퇴자 요청이 그대로 노출되고 수락 시 유령 친구가 생긴다.
     */
    List<Friendship> findByToUserAndStatusAndDeletedAtIsNull(User toUser, FriendshipStatus status);

    /**
     * 방향 고정 단건 조회 — REJECTED → PENDING 재전환 시 (me→target) row 특정용
     */
    Optional<Friendship> findByFromUserAndToUser(User fromUser, User toUser);

    /**
     * 요청 수락·거절 대상 단건 (GROMO-801) — 목록에서 숨긴 행은 변경도 막아야 계약이 일치한다.
     * 화면을 열어둔 사이 발신자가 탈퇴하면 클라가 들고 있던 requestId 로 수락을 호출할 수 있는데,
     * deletedAt 을 안 보면 200 + FRIEND_ADDED 이벤트가 나가고도 친구 목록엔 안 나타난다
     * (findAcceptedByUser 는 deletedAt IS NULL 이므로).
     *
     * 배타 락이 필요한 이유: deletedAt IS NULL 은 '조회 시점' 조건일 뿐이라 락 없이는 lost update 가 난다.
     * 수락이 행을 읽은 뒤 탈퇴가 그 행을 soft delete 하고 커밋하면, Friendship 에 @Version·@DynamicUpdate 가
     * 없어 수락의 더티체킹 UPDATE 가 전체 컬럼을 자기 스냅샷으로 덮어쓴다 → deletedAt 이 다시 null 이 되며
     * 관계가 ACCEPTED 로 되살아나 탈퇴자 유령 친구가 노출된다.
     * 락을 잡으면 READ COMMITTED 에서 Postgres 가 잠금 획득 후 조건을 재평가하므로,
     * 탈퇴가 먼저 커밋된 경우 이 조회가 빈 결과가 되어 REQUEST_NOT_FOUND 로 떨어진다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Friendship> findByIdAndDeletedAtIsNull(UUID id);

    /**
     * 알림 경로의 상태 재확인 전용 — 위 조회와 조건은 같지만 **락을 잡지 않는다**.
     * 위 findByIdAndDeletedAtIsNull 은 수락·거절이 행을 변경하기 직전에 쓰라고 만든 배타 락이다.
     * 그걸 알림 경로가 재사용하면, 잠긴 행이 그 트랜잭션이 끝날 때까지 — 즉 FCM 발송이 끝날 때까지 —
     * 묶인다. FCM RestClient 에 타임아웃이 없어 발송이 지연·정지하면 같은 요청의 수락·거절과
     * 관련 유저의 탈퇴가 무기한 대기하게 된다(@codex 리뷰 P1).
     * 알림은 행을 바꾸지 않고 "지금도 PENDING 인가" 만 보므로 락이 필요 없다. 이 조회와 발송 사이에
     * 상태가 바뀌는 경합은 남지만, 그건 락으로 못 막는다 — 발송은 어차피 트랜잭션 밖의 외부 호출이다.
     */
    @Query("select f.status from Friendship f where f.id = :id and f.deletedAt is null")
    Optional<FriendshipStatus> findStatusByIdAndDeletedAtIsNull(@Param("id") UUID id);

    boolean existsByFromUserAndToUser(User fromUser, User toUser);

    /**
     * 두 유저 사이 페어 양방향 조회 — (a→b) / (b→a) 모두 포함.
     * createRequest 의 중복·이미친구·REJECTED 재전환 판정용 (정렬: 최신 updatedAt 우선).
     * ⚠️ deletedAt 필터를 넣지 말 것 — createRequest 의 소프트삭제 행 복원 분기(GROMO-719)가
     * 삭제 행까지 돌려받는 데 의존한다. 필터가 생기면 재요청이 insert 로 빠져 F1(409)이 재발한다.
     */
    @Query("SELECT f FROM Friendship f"
            + " WHERE (f.fromUser = :a AND f.toUser = :b)"
            + " OR (f.fromUser = :b AND f.toUser = :a)"
            + " ORDER BY f.updatedAt DESC")
    List<Friendship> findPair(@Param("a") User a, @Param("b") User b);

    /**
     * 단일 ACCEPTED 친구 관계 양방향 단건 조회 (deletedAt IS NULL) — deleteFriend 용.
     */
    @Query("SELECT f FROM Friendship f"
            + " WHERE f.status = 'ACCEPTED'"
            + " AND f.deletedAt IS NULL"
            + " AND ((f.fromUser = :me AND f.toUser = :friend)"
            + " OR (f.fromUser = :friend AND f.toUser = :me))")
    Optional<Friendship> findAcceptedBetween(@Param("me") User me, @Param("friend") User friend);

    /**
     * 내 친구 목록 — ACCEPTED, 미삭제, 내가 from 또는 to인 모든 관계 (getFriends 용).
     */
    @Query("SELECT f FROM Friendship f"
            + " WHERE f.status = 'ACCEPTED'"
            + " AND f.deletedAt IS NULL"
            + " AND (f.fromUser = :me OR f.toUser = :me)")
    List<Friendship> findAcceptedByUser(@Param("me") User me);

    /**
     * 내 친구 상대편 id 집합 — ACCEPTED, 미삭제, from·to 양방향에서 나 아닌 쪽 id 를 모은다.
     * 리그 랭킹 isFriend 후조인용 (GROMO-1630) — PinnedUserRepository.findPinnedUserIdsByUserId 와 대칭.
     * 친구 수는 소수라 1쿼리 Set 대조로 충분하다.
     */
    @Query("SELECT CASE WHEN f.fromUser.id = :userId THEN f.toUser.id ELSE f.fromUser.id END"
            + " FROM Friendship f"
            + " WHERE f.status = 'ACCEPTED'"
            + " AND f.deletedAt IS NULL"
            + " AND (f.fromUser.id = :userId OR f.toUser.id = :userId)")
    Set<UUID> findFriendUserIdsByUserId(@Param("userId") UUID userId);

    /**
     * 친구 수 카운트 — ACCEPTED, 미삭제, from·to 양방향 (공개 프로필 집계용).
     */
    @Query("SELECT COUNT(f) FROM Friendship f"
            + " WHERE f.status = 'ACCEPTED'"
            + " AND f.deletedAt IS NULL"
            + " AND (f.fromUser = :me OR f.toUser = :me)")
    long countAcceptedByUser(@Param("me") User me);

    /**
     * 회원 탈퇴 정리 대상 — 내가 낀 미삭제 관계 전부, status 무관 (GROMO-801).
     * ACCEPTED(친구)뿐 아니라 PENDING(대기 중 요청)까지 걷어야 탈퇴자 요청이 상대 목록에 남지 않는다.
     * 벌크 UPDATE 대신 엔티티를 로드해 Friendship.softDelete() 를 태운다 — deletedAt 을 쓰는 통로를
     * 도메인 메서드 하나로 유지하기 위해서다. (현재 withdraw() 안에서는 벌크를 써도 깨지지 않는다:
     * 이 트랜잭션이 Friendship 을 다시 읽지 않아 1차 캐시 stale 이 실현되지 않는다. 다만 나중에
     * 같은 트랜잭션에서 Friendship 을 읽는 코드가 붙으면 그때 조용히 깨지므로 선제적으로 막아둔다.)
     * 탈퇴 1회당 많아야 수백 건이라 건별 처리 비용은 무의미하다.
     * 인덱스 주의: from_user_id 브랜치는 UNIQUE(from_user_id, to_user_id) 복합의 선두 컬럼으로 타지만,
     * to_user_id 단독 인덱스가 없어 아래 OR 의 그쪽 브랜치는 순차 스캔으로 빠진다
     * (PostgreSQL 은 FK 컬럼에 인덱스를 자동 생성하지 않는다).
     * findAcceptedByUser·countAcceptedByUser 등 기존 OR 조회가 이미 갖고 있던 특성이고, 탈퇴 경로가
     * 추가되며 노출 빈도만 늘었다. 인덱스 추가는 별도 티켓 — CREATE INDEX CONCURRENTLY 가 Flyway 의
     * 열린 트랜잭션을 기다리다 부팅을 멈추게 해서, 마이그레이션이 아닌 운영 절차로 다뤄야 한다.
     * 배타 락 — 위 findByIdAndDeletedAtIsNull 과 대칭. 정리 대상 행을 잠가야 수락·거절 트랜잭션과
     * 서로의 UPDATE 를 덮어쓰지 않는다(둘 다 전체 컬럼 UPDATE 라 나중 커밋이 이긴다).
     * 전제: 격리수준 READ COMMITTED. Postgres 가 잠금 획득 후 조건을 재평가(EvalPlanQual)하므로
     * 먼저 커밋한 쪽이 이기고 대기하던 쪽은 조용히 빈 결과가 된다. REPEATABLE READ 로 올리면
     * 재평가 대신 직렬화 실패 예외가 나므로 이 경로들에 재시도가 필요해진다(현재는 없음).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT f FROM Friendship f"
            + " WHERE f.deletedAt IS NULL"
            + " AND (f.fromUser.id = :userId OR f.toUser.id = :userId)")
    List<Friendship> findActiveByUserId(@Param("userId") UUID userId);
}

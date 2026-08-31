package com.oneorthree.phone.friend.repository;

import com.oneorthree.phone.friend.repository.domain.PinnedUser;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public interface PinnedUserRepository extends JpaRepository<PinnedUser, UUID> {

    /**
     * 멱등 핀 설정 — DB 차원 upsert. check-then-insert 경합(동시 요청) 시에도 500 없이 무시.
     * (JPA save는 commit 시점 flush라 try-catch로 못 잡고, 잡아도 트랜잭션이 rollback-only가 됨)
     */
    @Modifying
    @Query(value = "INSERT INTO pinned_users (id, user_id, pinned_user_id, created_at) "
            + "VALUES (:id, :userId, :pinnedUserId, now()) ON CONFLICT DO NOTHING", nativeQuery = true)
    void insertIgnoreConflict(@Param("id") UUID id,
                              @Param("userId") UUID userId,
                              @Param("pinnedUserId") UUID pinnedUserId);

    /**
     * 핀 해제 — 있으면 삭제, 없으면 멱등(no-op).
     */
    Optional<PinnedUser> findByUserAndPinnedUser(User user, User pinnedUser);

    /**
     * 내가 핀한 유저 전체 (조회 / getFriends isPinned 배선). pinnedUser fetch로 N+1 방지.
     */
    @EntityGraph(attributePaths = "pinnedUser")
    List<PinnedUser> findByUser(User user);

    /**
     * 내가 핀한 유저 id 집합 — 리그 랭킹 isPinned 후조인용(user 핀 통일, GROMO-609). 소수라 1쿼리로 충분.
     */
    @Query("select p.pinnedUser.id from PinnedUser p where p.user.id = :userId")
    Set<UUID> findPinnedUserIdsByUserId(@Param("userId") UUID userId);

    /**
     * 회원 탈퇴 — 내가 건 핀·남이 나를 건 핀 양방향 전부 (GROMO-801).
     * pinned_users 에는 소프트딜리트 컬럼이 없어 하드 삭제한다(핀은 이력 가치가 없는 표시용 관계).
     *
     * 파생 delete(select 후 건별 remove)를 쓰지 않는 이유: 같은 핀을 상대가 unpin 하는 것과 탈퇴가 겹치면
     * 양쪽이 같은 엔티티를 적재한 뒤, 먼저 커밋한 쪽이 행을 지워 나머지 한쪽의 DELETE 가 0 행을 만난다.
     * Hibernate 는 이걸 StaleStateException 으로 올려 요청 전체를 롤백시킨다 — 멱등해야 할 핀 해제와
     * 탈퇴가 500 으로 실패한다. 벌크 DELETE 는 0 행 매치를 정상으로 처리하므로 이 경합에 면역이다.
     * (PinnedUser 는 cascade·라이프사이클 콜백이 없는 단순 매핑이라 벌크로 잃는 것이 없다.)
     */
    @Modifying
    @Query("DELETE FROM PinnedUser p WHERE p.user.id = :userId OR p.pinnedUser.id = :userId")
    int deleteAllInvolving(@Param("userId") UUID userId);

    /**
     * 핀 해제 단건 — 위와 같은 이유로 벌크 DELETE. 반환 0 = 이미 없음(멱등, 에러 아님).
     */
    @Modifying
    @Query("DELETE FROM PinnedUser p WHERE p.user.id = :userId AND p.pinnedUser.id = :pinnedUserId")
    int deletePin(@Param("userId") UUID userId, @Param("pinnedUserId") UUID pinnedUserId);
}

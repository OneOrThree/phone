package com.oneorthree.phone.friend.repository;

import com.oneorthree.phone.friend.domain.PinnedUser;
import com.oneorthree.phone.user.domain.User;
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

    // 멱등 핀 설정 — DB 차원 upsert. check-then-insert 경합(동시 요청) 시에도 500 없이 무시.
    // (JPA save는 commit 시점 flush라 try-catch로 못 잡고, 잡아도 트랜잭션이 rollback-only가 됨)
    @Modifying
    @Query(value = "INSERT INTO pinned_users (id, user_id, pinned_user_id, created_at) "
            + "VALUES (:id, :userId, :pinnedUserId, now()) ON CONFLICT DO NOTHING", nativeQuery = true)
    void insertIgnoreConflict(@Param("id") UUID id,
                              @Param("userId") UUID userId,
                              @Param("pinnedUserId") UUID pinnedUserId);

    // 핀 해제 — 있으면 삭제, 없으면 멱등(no-op).
    Optional<PinnedUser> findByUserAndPinnedUser(User user, User pinnedUser);

    // 내가 핀한 유저 전체 (조회 / getFriends isPinned 배선). pinnedUser fetch로 N+1 방지.
    @EntityGraph(attributePaths = "pinnedUser")
    List<PinnedUser> findByUser(User user);

    // 내가 핀한 유저 id 집합 — 리그 랭킹 isPinned 후조인용(user 핀 통일, GROMO-609). 소수라 1쿼리로 충분.
    @Query("select p.pinnedUser.id from PinnedUser p where p.user.id = :userId")
    Set<UUID> findPinnedUserIdsByUserId(@Param("userId") UUID userId);

    // 회원 탈퇴 — 내가 건 핀·남이 나를 건 핀 양방향 전부 (GROMO-801).
    // pinned_users 에는 소프트딜리트 컬럼이 없어 하드 삭제한다(핀은 이력 가치가 없는 표시용 관계).
    // 파생 delete 라 엔티티를 로드한 뒤 건별 삭제 — 벌크 @Query 와 달리 영속성 컨텍스트·라이프사이클을 우회하지 않는다.
    void deleteByUserIdOrPinnedUserId(UUID userId, UUID pinnedUserId);
}

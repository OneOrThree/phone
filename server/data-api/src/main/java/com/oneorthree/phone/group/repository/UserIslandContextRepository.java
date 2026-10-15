package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/**
 * 사용자의 현재 섬 컨텍스트 — PK 가 곧 유저 id 다(1:1, GROMO-1907).
 *
 * <p>이 행을 바꾸는 모든 경로는 호출측이 users 행을 배타 락
 * ({@code UserQueryService#getCallerForUpdate})으로 <b>먼저</b> 쥔 뒤에만 {@link #findByIdForUpdate}
 * 를 써야 한다(island-membership LLD §4 잠금 순서: users/context → groups → memberships/requests).
 * 실제 취득은 {@link com.oneorthree.phone.group.service.UserIslandContextLockService} 를 거친다.
 *
 * <p>users 행이 이미 배타 락이므로 이 행의 <b>첫 생성</b> 경합은 없다 — 두 트랜잭션이 동시에 같은
 * 유저의 컨텍스트를 처음 만들려 해도 users 행에서 이미 직렬화돼 있다. 그래서
 * {@code AggregateVersionAllocator} 류의 insert-then-relock 이 여기엔 필요 없다.
 */
public interface UserIslandContextRepository extends JpaRepository<UserIslandContext, UUID> {

    /**
     * 컨텍스트 행 배타 락 조회 — <b>반드시</b> users 행을 배타 락으로 쥔 트랜잭션 안에서만 부를 것.
     *
     * @param userId 컨텍스트 주인
     * @return 잠긴 컨텍스트 행. 첫 소속 이전이면 비어 있다 — 호출측이 새로 만든다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from UserIslandContext c where c.userId = :userId")
    Optional<UserIslandContext> findByIdForUpdate(@Param("userId") UUID userId);
}

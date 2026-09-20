package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.UserMainIsland;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 명시적으로 고른 메인 섬 행 (GROMO-1971, V81).
 *
 * <p><b>행이 없는 것은 오류가 아니다</b> — 아직 고른 적 없다는 뜻이고, 그때의 메인 섬은
 * {@code MainIslandService} 가 활성 멤버십에서 도출한다. 그래서 여기에는 「없으면 던지는」 조회가 없다.
 */
public interface UserMainIslandRepository extends JpaRepository<UserMainIsland, UUID> {

    /**
     * 명시 선택분의 섬 <b>이름까지</b> 한 번에 — 친구 목록의 N+1 방지.
     *
     * @param userIds 조회 대상. 비어 있으면 빈 목록
     * @return 행이 있는 사용자분만. <b>없는 사용자는 결과에서 빠지므로</b> 호출측이 도출로 메운다
     */
    @Query("SELECT new com.oneorthree.phone.group.repository.UserIslandNameProjection("
            + "m.userId, m.island.id, m.island.name) FROM UserMainIsland m WHERE m.userId IN :userIds")
    List<UserIslandNameProjection> findChosenByUserIdIn(@Param("userIds") Collection<UUID> userIds);
}

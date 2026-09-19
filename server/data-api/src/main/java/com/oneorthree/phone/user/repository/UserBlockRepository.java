package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserBlock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * user_blocks 매핑 리포지토리.
 *
 * <p>GROMO-676 스키마+매핑 선반영 — 차단 기능 로직은 별도 티켓에서 구현한다.
 */
public interface UserBlockRepository extends JpaRepository<UserBlock, UUID> {

    /**
     * (blocker → blocked) 방향 고정 단건 조회
     *
     * @param blocker 차단한 쪽
     * @param blocked 차단당한 쪽
     * @return 그 방향의 차단 행. <b>방향이 고정</b>이라 반대 방향 차단은 잡히지 않는다 —
     *         상호 차단 여부를 보려면 두 번 물어야 한다
     */
    Optional<UserBlock> findByBlockerAndBlocked(User blocker, User blocked);

    /**
     * blocker 가 차단한 목록
     *
     * @param blocker 차단한 쪽
     * @return 이 유저가 차단한 관계. <b>자신을 차단한 사람들은 들어 있지 않다</b>
     */
    List<UserBlock> findByBlocker(User blocker);

    /**
     * 탈퇴자가 낀 차단을 <b>양방향 모두</b> 지운다 (GROMO-1801 · 계정 LLD §4 user_blocks).
     *
     * <p>한 방향만 지우거나 삭제 flag 로 남기면 관계 원문이 남는다. UserBlock 은 cascade·콜백이 없는
     * 단순 매핑이라 벌크로 잃는 것이 없다.
     *
     * @param userId 탈퇴하는 유저
     * @return 지운 행 수. 0 도 정상이다
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM UserBlock b WHERE b.blocker.id = :userId OR b.blocked.id = :userId")
    int deleteAllInvolving(@Param("userId") UUID userId);
}

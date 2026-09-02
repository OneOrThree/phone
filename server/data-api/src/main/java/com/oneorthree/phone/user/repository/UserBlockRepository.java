package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserBlock;
import org.springframework.data.jpa.repository.JpaRepository;

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
}

package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserBlock;
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
     */
    Optional<UserBlock> findByBlockerAndBlocked(User blocker, User blocked);

    /**
     * blocker 가 차단한 목록
     */
    List<UserBlock> findByBlocker(User blocker);
}

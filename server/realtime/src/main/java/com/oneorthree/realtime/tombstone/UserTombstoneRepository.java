package com.oneorthree.realtime.tombstone;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.Set;
import java.util.UUID;

/** 탈퇴 사용자 tombstone 조회. */
public interface UserTombstoneRepository extends JpaRepository<UserTombstone, UUID> {

    /**
     * 주어진 사용자 중 탈퇴한 사람만 — 목록 응답의 발신자를 <b>한 번에</b> 대조한다(메시지마다 조회하지 않는다).
     *
     * @param userIds 대조할 사용자. 비어 있으면 부르지 않는다({@code IN ()} 은 SQL 오류다)
     * @return 그중 tombstone 이 있는 사용자
     */
    @Query("SELECT t.userId FROM UserTombstone t WHERE t.userId IN :userIds")
    Set<UUID> findWithdrawnAmong(@Param("userIds") Collection<UUID> userIds);
}

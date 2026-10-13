package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusLiveActivity;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FocusLiveActivityRepository extends JpaRepository<FocusLiveActivity, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM FocusLiveActivity a WHERE a.sessionId = :sessionId")
    Optional<FocusLiveActivity> findBySessionIdForUpdate(UUID sessionId);

    // 변하지 않은 활성 행은 배치를 점유하지 않는다. 전이 버전·최초 등록·만료만 후보가 된다.
    @Query("""
            SELECT a.sessionId FROM FocusLiveActivity a
            JOIN FocusSessionDetail s ON s.sessionId = a.sessionId
            WHERE a.expiresAt <= :now
               OR (a.nextAttemptAt <= :now AND (a.sentVersion <> s.version OR s.userId IS NULL))
            ORDER BY a.nextAttemptAt
            """)
    List<UUID> findDue(Instant now, Pageable page);
}

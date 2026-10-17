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

    // Android는 하루마다 정본을 재전송해 기기 차단 유효기간을 갱신한다. 나머지 동일 버전은 제외한다.
    @Query("""
            SELECT a.sessionId FROM FocusLiveActivity a
            JOIN FocusSessionDetail s ON s.sessionId = a.sessionId
            WHERE a.expiresAt <= :now
               OR (a.nextAttemptAt <= :now AND (a.sentVersion <> s.version OR s.userId IS NULL
                   OR (a.environment = 'android' AND a.sentTimestamp <= :refreshBefore)))
            ORDER BY a.nextAttemptAt
            """)
    List<UUID> findDueForRefresh(Instant now, long refreshBefore, Pageable page);

    default List<UUID> findDue(Instant now, Pageable page) {
        return findDueForRefresh(now, now.minusSeconds(86400).getEpochSecond(), page);
    }
}

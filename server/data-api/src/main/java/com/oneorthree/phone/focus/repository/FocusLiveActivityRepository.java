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

    @Query("SELECT a.sessionId FROM FocusLiveActivity a WHERE a.nextAttemptAt <= :now ORDER BY a.nextAttemptAt")
    List<UUID> findDue(Instant now, Pageable page);
}

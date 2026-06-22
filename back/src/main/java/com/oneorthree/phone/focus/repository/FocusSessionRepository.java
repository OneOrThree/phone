package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface FocusSessionRepository extends JpaRepository<FocusSession, UUID> {

    @Query("SELECT s FROM FocusSession s LEFT JOIN FETCH s.focusTag WHERE s.user = :user ORDER BY s.startedAt DESC")
    List<FocusSession> findByUserWithTag(@Param("user") User user);

    List<FocusSession> findByUserAndStartedAtBetween(User user, Instant from, Instant to);

    @Modifying
    @Query("UPDATE FocusSession f SET f.user = null WHERE f.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);
}

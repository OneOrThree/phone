package com.oneorthree.phone.repository.focus;

import com.oneorthree.phone.domain.focus.FocusSession;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface FocusSessionRepository extends JpaRepository<FocusSession, Long> {
    List<FocusSession> findByUser(User user);
    List<FocusSession> findByUserAndStartedAtBetween(User user, Instant from, Instant to);
}

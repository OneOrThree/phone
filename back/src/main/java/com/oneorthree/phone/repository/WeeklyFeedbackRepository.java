package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.User;
import com.oneorthree.phone.domain.WeeklyFeedback;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;

public interface WeeklyFeedbackRepository extends JpaRepository<WeeklyFeedback, Long> {
    Optional<WeeklyFeedback> findByUserAndWeekStart(User user, Instant weekStart);
}

package com.oneorthree.phone.feedback.repository;

import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.feedback.domain.WeeklyFeedback;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface WeeklyFeedbackRepository extends JpaRepository<WeeklyFeedback, UUID> {

    Optional<WeeklyFeedback> findByUserAndWeekStart(User user, Instant weekStart);
}

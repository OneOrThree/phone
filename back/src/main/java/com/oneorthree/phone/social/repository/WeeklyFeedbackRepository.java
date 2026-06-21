package com.oneorthree.phone.social.repository;

import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.social.domain.WeeklyFeedback;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;

public interface WeeklyFeedbackRepository extends JpaRepository<WeeklyFeedback, Long> {

    Optional<WeeklyFeedback> findByUserAndWeekStart(User user, Instant weekStart);
}

package com.oneorthree.phone.repository.social;

import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.domain.social.WeeklyFeedback;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface WeeklyFeedbackRepository extends JpaRepository<WeeklyFeedback, UUID> {

    Optional<WeeklyFeedback> findByUserAndWeekStart(User user, Instant weekStart);
}

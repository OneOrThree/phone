package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.User;
import com.oneorthree.phone.domain.UserStreak;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserStreakRepository extends JpaRepository<UserStreak, Long> {
    Optional<UserStreak> findByUser(User user);
}

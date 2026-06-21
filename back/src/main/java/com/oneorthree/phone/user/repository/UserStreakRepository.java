package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserStreakRepository extends JpaRepository<UserStreak, Long> {

    Optional<UserStreak> findByUser(User user);
}

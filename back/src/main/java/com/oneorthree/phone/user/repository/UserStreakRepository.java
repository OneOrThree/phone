package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface UserStreakRepository extends JpaRepository<UserStreak, UUID> {

    Optional<UserStreak> findByUser(User user);
}

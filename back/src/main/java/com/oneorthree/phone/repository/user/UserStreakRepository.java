package com.oneorthree.phone.repository.user;

import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.domain.user.UserStreak;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserStreakRepository extends JpaRepository<UserStreak, Long> {

    Optional<UserStreak> findByUser(User user);
}

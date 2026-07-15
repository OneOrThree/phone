package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserStreakRepository extends JpaRepository<UserStreak, UUID> {

    Optional<UserStreak> findByUser(User user);

    // 스트릭 위기 알림(GROMO-841) — 출석 스트릭 진행 중(streakCount>0, 미탈퇴)인 유저.
    List<UserStreak> findByStreakCountGreaterThanAndDeletedAtIsNull(int threshold);
}

package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserStreakRepository extends JpaRepository<UserStreak, UUID> {

    Optional<UserStreak> findByUser(User user);

    // 스트릭 위기 알림(GROMO-841) — 아직 살아있는(오늘 이어갈 수 있는) 스트릭만.
    // 스트릭은 다음 세션에서 lazy reset 되므로, 이미 끊긴(마지막 세션이 그저께 이전) 유저도
    // streakCount 가 양수로 남아있다. lastSessionDate >= 어제 조건으로 그들을 제외해야
    // 매일 밤 "끊길라" 헛 알림을 막을 수 있다.
    List<UserStreak> findByStreakCountGreaterThanAndLastSessionDateGreaterThanEqualAndDeletedAtIsNull(
            int threshold, LocalDate minLastSessionDate);
}

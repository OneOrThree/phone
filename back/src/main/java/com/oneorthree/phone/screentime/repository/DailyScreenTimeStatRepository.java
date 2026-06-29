package com.oneorthree.phone.screentime.repository;

import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface DailyScreenTimeStatRepository extends JpaRepository<DailyScreenTimeStat, UUID> {
    // TODO GROMO-551: 메서드 (focus/repository/DailyFocusStatRepository.java 패턴 미러)
    //   - Optional<DailyScreenTimeStat> findByUserAndDate(User user, LocalDate date)
    //       → ScreenTimeService 의 일별 upsert 조회
    //   - List<DailyScreenTimeStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to)
    //       → StatsService 히트맵 범위 조회
    //   - @Modifying @Query("UPDATE DailyScreenTimeStat d SET d.user = null WHERE d.user.id = :userId")
    //     void nullifyUser(@Param("userId") UUID userId)
    //       → UserService.withdraw 탈퇴 익명화
}

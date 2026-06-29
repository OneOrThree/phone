package com.oneorthree.phone.screentime.repository;

import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DailyScreenTimeStatRepository extends JpaRepository<DailyScreenTimeStat, UUID> {

    Optional<DailyScreenTimeStat> findByUserAndDate(User user, LocalDate date);

    List<DailyScreenTimeStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);

    @Modifying
    @Query("UPDATE DailyScreenTimeStat d SET d.user = null WHERE d.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);
}

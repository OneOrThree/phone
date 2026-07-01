package com.oneorthree.phone.stats.repository;

import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DailyFocusStatRepository extends JpaRepository<DailyFocusStat, UUID> {

    Optional<DailyFocusStat> findByUserAndDate(User user, LocalDate date);

    List<DailyFocusStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);

    @Modifying
    @Query("UPDATE DailyFocusStat d SET d.user = null WHERE d.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);

    List<DailyFocusStat> findByUserInAndDate(Collection<User> users, LocalDate date);
}

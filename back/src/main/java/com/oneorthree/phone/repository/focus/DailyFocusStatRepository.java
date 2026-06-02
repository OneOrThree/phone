package com.oneorthree.phone.repository.focus;

import com.oneorthree.phone.domain.focus.DailyFocusStat;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface DailyFocusStatRepository extends JpaRepository<DailyFocusStat, Long> {
    Optional<DailyFocusStat> findByUserAndDate(User user, LocalDate date);
    List<DailyFocusStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);
}

package com.oneorthree.phone.repository.focus;

import com.oneorthree.phone.domain.focus.DailyFocusStat;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface DailyFocusStatRepository extends JpaRepository<DailyFocusStat, Long> {

    Optional<DailyFocusStat> findByUserAndDate(User user, LocalDate date);

    List<DailyFocusStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);

    @Modifying
    @Query("UPDATE DailyFocusStat d SET d.user = null WHERE d.user.id = :userId")
    void nullifyUser(@Param("userId") Long userId);

    // TODO GROMO-369: 멤버 배치 조회 메서드 추가 (N+1 방지)
    //  - List<DailyFocusStat> findByUserInAndDate(Collection<User> users, LocalDate date)
    //  - import: java.util.Collection
}

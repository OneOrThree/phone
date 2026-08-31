package com.oneorthree.phone.screentime.repository;

import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DailyScreenTimeStatRepository extends JpaRepository<DailyScreenTimeStat, UUID> {

    Optional<DailyScreenTimeStat> findByUserAndDate(User user, LocalDate date);

    /**
     * 여러 유저의 당일({@code date}) 스크린타임 집계를 IN 1회로 배치 조회한다.
     * 그룹 챌린지 진행률이 멤버마다 findByUserAndDate 를 돌지 않게 하는 용도
     * ({@code DailyFocusStatRepository.findByUserInAndDate} 의 스크린타임 짝).
     * 통계 행이 없는 유저는 결과에 없으므로 호출측이 "데이터 없음"(null)으로 다룬다.
     */
    List<DailyScreenTimeStat> findByUserInAndDate(Collection<User> users, LocalDate date);

    List<DailyScreenTimeStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);

    @Modifying
    @Query("UPDATE DailyScreenTimeStat d SET d.user = null WHERE d.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);
}

package com.oneorthree.phone.stats.repository;

import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
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

    // UPDATE-UPDATE lost update 방지(누적 연산): 비관적 쓰기 잠금으로 동시 세션 저장 시 += 누락 차단
    // INSERT-INSERT 동시 삽입은 unique(user_id, date) 제약이 정합성 보장(오염 없음, 실패 건은 클라 재시도)
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT d FROM DailyFocusStat d WHERE d.user = :user AND d.date = :date")
    Optional<DailyFocusStat> findByUserAndDateForUpdate(@Param("user") User user, @Param("date") LocalDate date);

    List<DailyFocusStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);

    @Modifying
    @Query("UPDATE DailyFocusStat d SET d.user = null WHERE d.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);

    List<DailyFocusStat> findByUserInAndDate(Collection<User> users, LocalDate date);

    /**
     * [from, to] 구간의 totalFocusSeconds 합계를 반환한다(초 — GROMO-642).
     * 데이터 없는 구간은 COALESCE → 0 반환(null 처리 불필요).
     */
    @Query("SELECT COALESCE(SUM(d.totalFocusSeconds), 0) "
            + "FROM DailyFocusStat d WHERE d.user = :user AND d.date BETWEEN :from AND :to")
    int sumTotalFocusSecondsByUserAndDateBetween(
            @Param("user") User user,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);
}

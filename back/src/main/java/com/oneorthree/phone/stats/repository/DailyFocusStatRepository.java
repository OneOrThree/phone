package com.oneorthree.phone.stats.repository;

import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.dto.FocusAverageAggregate;
import com.oneorthree.phone.user.domain.Occupation;
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
     * userId 집합의 당일({@code date}) 집계를 배치 조회한다 (GROMO-822, FocusLiveInfoLookup 공용).
     * User 기반 {@link #findByUserInAndDate} 의 UUID 변형 — 헬퍼가 도메인(friend/league)에 무관하게 userId 로 받기 위함.
     */
    @Query("SELECT d FROM DailyFocusStat d WHERE d.user.id IN :userIds AND d.date = :date")
    List<DailyFocusStat> findByUserIdInAndDate(@Param("userIds") Collection<UUID> userIds,
                                               @Param("date") LocalDate date);

    /**
     * 주어진 유저 중 {@code date} 당일 집중 초가 0 보다 큰(이미 오늘 집중한) 유저 id 를 반환한다.
     * DailyFocusStat 는 세션 종료일(endedAt) 기준이라 자정을 넘겨 끝난 세션도 오늘로 귀속되어 잡힌다
     * (startedAt 기준 조회가 놓치는 케이스 보완 — GROMO-841).
     */
    @Query("SELECT d.user.id FROM DailyFocusStat d "
            + "WHERE d.user.id IN :userIds AND d.date = :date AND d.totalFocusSeconds > 0")
    List<UUID> findUserIdsWithFocusOnDate(
            @Param("userIds") Collection<UUID> userIds,
            @Param("date") LocalDate date);

    /**
     * [from, to] 중 하루 누적 집중이 {@code minSeconds} 이상인(= 스트릭 자격을 갖춘) 날짜들
     * (GROMO-1252 코드리뷰 5차 ③ — {@code UserStreakService} 의 소급 재구성 전용).
     *
     * <p>판정은 <b>차감·재집계가 반영된 현재</b> {@code totalFocusSeconds} 기준이다. 구간 상한은 호출측이
     * 정한다(무제한 스캔 금지).
     */
    @Query("SELECT d.date FROM DailyFocusStat d "
            + "WHERE d.user = :user AND d.date BETWEEN :from AND :to AND d.totalFocusSeconds >= :minSeconds")
    List<LocalDate> findQualifiedDates(
            @Param("user") User user,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to,
            @Param("minSeconds") int minSeconds);

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

    // ── 평균 집중시간 집계 (GROMO-753) ─────────────────────────────────────
    // 모수 유저의 [from,to] 집중 초 총합 + 활동(row≥1) 유저 수를 한 쿼리로 반환한다.
    // 평균 = floor(totalSeconds / activeUserCount / 60) 는 서비스에서 계산(count=0 → null).
    // COUNT(DISTINCT user.id) 로 활동 유저만 모수에 세고(휴면 유저 자연 제외), COALESCE(SUM,0) 으로 무데이터 0 보장.

    /**
     * 주어진 유저 집합(친구/카테고리) 중 기간 내 활동 유저의 집중 초 총합·활동 유저 수를 집계한다.
     * (호출 측이 빈 집합은 사전 차단 — 빈 IN 절 회피)
     */
    @Query("SELECT new com.oneorthree.phone.stats.dto.FocusAverageAggregate("
            + "COALESCE(SUM(d.totalFocusSeconds), 0), COUNT(DISTINCT d.user.id)) "
            + "FROM DailyFocusStat d WHERE d.user IN :users AND d.date BETWEEN :from AND :to")
    FocusAverageAggregate sumAndActiveCountByUsersInPeriod(
            @Param("users") Collection<User> users,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    /**
     * 전체 유저(탈퇴 유저 {@code user IS NULL} 제외) 중 기간 내 활동 유저의 집중 초 총합·활동 유저 수를 집계한다.
     */
    @Query("SELECT new com.oneorthree.phone.stats.dto.FocusAverageAggregate("
            + "COALESCE(SUM(d.totalFocusSeconds), 0), COUNT(DISTINCT d.user.id)) "
            + "FROM DailyFocusStat d WHERE d.user.id IS NOT NULL AND d.date BETWEEN :from AND :to")
    FocusAverageAggregate sumAndActiveCountAllInPeriod(
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    /**
     * 특정 occupation 유저 중 기간 내 활동 유저의 집중 초 총합·활동 유저 수를 집계한다.
     * (user IS NULL 인 탈퇴 row 는 occupation 조인 시 자연 제외)
     */
    @Query("SELECT new com.oneorthree.phone.stats.dto.FocusAverageAggregate("
            + "COALESCE(SUM(d.totalFocusSeconds), 0), COUNT(DISTINCT d.user.id)) "
            + "FROM DailyFocusStat d WHERE d.user.occupation = :occupation AND d.date BETWEEN :from AND :to")
    FocusAverageAggregate sumAndActiveCountByOccupationInPeriod(
            @Param("occupation") Occupation occupation,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    /**
     * userId 집합의 전체 기간 누적 집중 초 합계를 유저별로 배치 조회한다 (A-8 그룹방 리더보드).
     * 집중 기록이 없는 유저는 결과 행이 없으므로 호출측이 0으로 채운다.
     */
    @Query("SELECT d.user.id AS userId, COALESCE(SUM(d.totalFocusSeconds), 0) AS totalSeconds "
            + "FROM DailyFocusStat d WHERE d.user.id IN :userIds GROUP BY d.user.id")
    List<UserFocusTotal> sumTotalFocusSecondsByUserIdIn(@Param("userIds") Collection<UUID> userIds);

    /** {@link #sumTotalFocusSecondsByUserIdIn} 결과 행 — 유저 id 와 전체 누적 집중 초. */
    interface UserFocusTotal {
        UUID getUserId();

        long getTotalSeconds();
    }
}

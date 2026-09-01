package com.oneorthree.phone.stats.repository;

import com.oneorthree.phone.stats.repository.domain.DailyFocusStat;
import com.oneorthree.phone.stats.dto.FocusAverageAggregate;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.User;
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

/**
 * 일별 집중 집계(daily_focus_stats) 창구 — 통계·리그·친구 화면이 공유하는 집중 시간의 단일 원천이다.
 *
 * <p><b>날짜 축</b>: {@code date} 는 세션 <b>종료일</b>(endedAt)을 KST 로 자른 값이다
 * ({@link com.oneorthree.phone.common.util.ZonePolicy} 고정). 자정을 넘겨 끝난 세션은 시작일이 아니라
 * 끝난 날에 귀속되므로, 시작 시각 기준으로 다시 세면 값이 갈린다. 기기 로컬 날짜를 그대로 넣으면
 * 비-KST 기기에서 인접 버킷을 조회하게 된다.
 *
 * <p><b>기간 경계</b>: 여기 있는 모든 기간 조회는 {@code BETWEEN :from AND :to} — <b>양끝 모두 포함</b>이다.
 * 상한을 배타로 다루는 호출측 코드가 있으면 하루가 어긋난다. 상한 자체는 리포지토리가 막지 않으므로
 * 호출측이 정해야 한다(무제한 스캔 금지).
 *
 * <p><b>모수</b>: 합계·평균 집계는 COALESCE 로 무데이터를 0 으로 접고, 활동 유저 수는
 * {@code COUNT(DISTINCT user)} 라 행이 하나도 없는 휴면 유저는 애초에 세지 않는다.
 */
public interface DailyFocusStatRepository extends JpaRepository<DailyFocusStat, UUID> {

    /**
     * @param user 집계의 주인
     * @param date 조회할 날짜(세션 종료일 축, KST)
     * @return 그날 집계 행. 그날 완료한 세션이 없으면 행 자체가 없어 빈 값이다
     */
    Optional<DailyFocusStat> findByUserAndDate(User user, LocalDate date);

    /**
     * UPDATE-UPDATE lost update 방지(누적 연산): 비관적 쓰기 잠금으로 동시 세션 저장 시 += 누락 차단
     * INSERT-INSERT 동시 삽입은 unique(user_id, date) 제약이 정합성 보장(오염 없음, 실패 건은 클라 재시도)
     *
     * @param user 집계의 주인
     * @param date 갱신할 날짜(세션 종료일 축, KST)
     * @return 잠긴 집계 행. 트랜잭션이 끝날 때까지 같은 (user, date) 의 다른 누적 갱신은 대기한다.
     *         행이 아직 없으면 빈 값이고, 그때는 새로 넣는다 — 동시 삽입은 유니크 제약이 막는다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT d FROM DailyFocusStat d WHERE d.user = :user AND d.date = :date")
    Optional<DailyFocusStat> findByUserAndDateForUpdate(@Param("user") User user, @Param("date") LocalDate date);

    /**
     * 히트맵처럼 기간을 훑는 조회. <b>있는 날의 행만</b> 돌아오므로 빈 날을 0 으로 메우는 것은 호출측 몫이다.
     *
     * @param user 집계의 주인
     * @param from 시작일 — 포함
     * @param to   종료일 — 포함
     * @return 날짜 오름차순 집계 행. 길이가 기간 일수보다 짧을 수 있다
     */
    List<DailyFocusStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);

    /**
     * 탈퇴 정리 — 집계 행을 지우지 않고 주인만 떼어 낸다. 개인을 식별할 수 없게 하면서도 전체 평균 같은
     * 익명 집계의 모수는 보존하려는 선택이다(주인 없는 행은 전체 평균 쿼리에서 제외된다).
     *
     * @param userId 탈퇴하는 유저
     */
    @Modifying
    @Query("UPDATE DailyFocusStat d SET d.user = null WHERE d.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);

    /**
     * 여러 유저의 같은 날 집계를 한 번에 — 친구·핀 목록의 N+1 을 막는다.
     *
     * @param users 집계를 볼 유저들. 빈 컬렉션은 호출 전에 걸러야 한다(빈 IN 절)
     * @param date  조회할 날짜(세션 종료일 축, KST)
     * @return 행이 있는 유저의 집계만. 그날 기록이 없는 유저는 빠지므로 호출측이 0 으로 채운다
     */
    List<DailyFocusStat> findByUserInAndDate(Collection<User> users, LocalDate date);

    /**
     * userId 집합의 당일({@code date}) 집계를 배치 조회한다 (GROMO-822, FocusLiveInfoLookup 공용).
     * User 기반 {@link #findByUserInAndDate} 의 UUID 변형 — 헬퍼가 도메인(friend/league)에 무관하게 userId 로 받기 위함.
     *
     * @param userIds 집계를 볼 유저 id 들. 빈 컬렉션은 호출 전에 걸러야 한다
     * @param date    조회할 날짜(세션 종료일 축, KST)
     * @return 행이 있는 유저의 집계만 — 요청한 수보다 적게 올 수 있다
     */
    @Query("SELECT d FROM DailyFocusStat d WHERE d.user.id IN :userIds AND d.date = :date")
    List<DailyFocusStat> findByUserIdInAndDate(@Param("userIds") Collection<UUID> userIds,
                                               @Param("date") LocalDate date);

    /**
     * 주어진 유저 중 {@code date} 당일 집중 초가 0 보다 큰(이미 오늘 집중한) 유저 id 를 반환한다.
     * DailyFocusStat 는 세션 종료일(endedAt) 기준이라 자정을 넘겨 끝난 세션도 오늘로 귀속되어 잡힌다
     * (startedAt 기준 조회가 놓치는 케이스 보완 — GROMO-841).
     *
     * @param userIds 확인할 유저 id 들
     * @param date    판정 기준일(세션 종료일 축, KST)
     * @return 그날 집중 초가 0 초과인 유저 id. 행은 있지만 0 초인 유저는 빠진다
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
     *
     * @param user       스트릭의 주인
     * @param from       시작일 — 포함
     * @param to         종료일 — 포함
     * @param minSeconds 하루 자격 기준 초 — <b>이상</b>(경계값 포함)이면 자격을 얻는다
     * @return 자격을 갖춘 날짜들. 연속 여부는 판정하지 않으므로 이어 붙이는 것은 호출측 몫이다
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
     *
     * @param user 집계의 주인
     * @param from 시작일 — 포함
     * @param to   종료일 — 포함
     * @return 기간 총 집중 초. 행이 하나도 없어도 null 이 아니라 0 이다
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
     *
     * @param users 모수가 될 유저들. 친구 평균이면 자기 자신은 호출측이 이미 뺀 상태다
     * @param from  시작일 — 포함
     * @param to    종료일 — 포함
     * @return 집중 초 총합과 <b>활동 유저 수</b>. 분모는 모수 전체가 아니라 그 기간에 행이 있는 유저 수라,
     *         휴면 유저가 평균을 끌어내리지 않는다. 평균 계산과 0명 처리는 호출측이 한다
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
     *
     * <p>봇({@code is_bot})은 제외한다 (GROMO-1565). 봇은 리그 랭킹에는 실유저와 함께 보여야 하지만,
     * 유저가 자기 기록과 견주는 <b>모집단 평균</b>에 섞이면 합계와 표본 수를 동시에 밀어 올려
     * "나는 평균보다 한참 아래"라는 잘못된 인상을 준다. 랭킹 노출과 평균 모집단은 분리한다.
     *
     * @param from 시작일 — 포함
     * @param to   종료일 — 포함
     * @return 집중 초 총합과 활동 유저 수. 탈퇴로 주인이 떨어져 나간 행과 봇은 양쪽 모두에서 빠진다
     */
    @Query("SELECT new com.oneorthree.phone.stats.dto.FocusAverageAggregate("
            + "COALESCE(SUM(d.totalFocusSeconds), 0), COUNT(DISTINCT d.user.id)) "
            + "FROM DailyFocusStat d "
            + "WHERE d.user.id IS NOT NULL AND d.user.isBot = false AND d.date BETWEEN :from AND :to")
    FocusAverageAggregate sumAndActiveCountAllInPeriod(
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    /**
     * 특정 occupation 유저 중 기간 내 활동 유저의 집중 초 총합·활동 유저 수를 집계한다.
     * (user IS NULL 인 탈퇴 row 는 occupation 조인 시 자연 제외)
     *
     * <p>봇 제외 이유는 {@link #sumAndActiveCountAllInPeriod} 와 같다 (GROMO-1565). 직군 평균은
     * 직군당 봇이 10명씩이라 실유저가 적은 직군일수록 왜곡이 더 크다.
     *
     * @param occupation 모수를 좁힐 직군. 조회자가 직군 미설정이면 호출측이 애초에 부르지 않는다
     * @param from       시작일 — 포함
     * @param to         종료일 — 포함
     * @return 집중 초 총합과 활동 유저 수
     */
    @Query("SELECT new com.oneorthree.phone.stats.dto.FocusAverageAggregate("
            + "COALESCE(SUM(d.totalFocusSeconds), 0), COUNT(DISTINCT d.user.id)) "
            + "FROM DailyFocusStat d "
            + "WHERE d.user.occupation = :occupation AND d.user.isBot = false "
            + "AND d.date BETWEEN :from AND :to")
    FocusAverageAggregate sumAndActiveCountByOccupationInPeriod(
            @Param("occupation") Occupation occupation,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    /**
     * userId 집합의 전체 기간 누적 집중 초 합계를 유저별로 배치 조회한다 (A-8 그룹방 리더보드).
     * 집중 기록이 없는 유저는 결과 행이 없으므로 호출측이 0으로 채운다.
     *
     * @param userIds 합계를 볼 유저 id 들
     * @return 유저별 전체 기간 누적 초. 기간을 자르지 않는 유일한 집계라 리더보드 누적값에만 쓴다
     */
    @Query("SELECT d.user.id AS userId, COALESCE(SUM(d.totalFocusSeconds), 0) AS totalSeconds "
            + "FROM DailyFocusStat d WHERE d.user.id IN :userIds GROUP BY d.user.id")
    List<UserFocusTotal> sumTotalFocusSecondsByUserIdIn(@Param("userIds") Collection<UUID> userIds);

    /** {@link #sumTotalFocusSecondsByUserIdIn} 결과 행 — 유저 id 와 전체 누적 집중 초. */
    interface UserFocusTotal {
        /**
         * @return 이 행의 주인
         */
        UUID getUserId();

        /**
         * @return 그 유저의 전체 기간 누적 집중 초
         */
        long getTotalSeconds();
    }
}

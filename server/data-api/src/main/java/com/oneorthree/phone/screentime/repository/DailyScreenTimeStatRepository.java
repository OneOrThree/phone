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

/**
 * 일별 스크린타임 집계. (user, date) 가 유니크하고 date 는 언제나 KST 기준 날짜다 —
 * 기기 로컬 날짜로 조회하면 자정 근처 하루가 어긋난다.
 */
public interface DailyScreenTimeStatRepository extends JpaRepository<DailyScreenTimeStat, UUID> {

    /**
     * 특정 날짜의 집계 한 건을 읽는다.
     *
     * @param user 대상 유저
     * @param date KST 기준 날짜
     * @return 그날 보고가 있으면 해당 행. 없으면 empty 이고, 이는 "0분 사용"이 아니라 "보고 없음"을 뜻한다
     */
    Optional<DailyScreenTimeStat> findByUserAndDate(User user, LocalDate date);

    /**
     * 여러 유저의 당일({@code date}) 스크린타임 집계를 IN 1회로 배치 조회한다.
     * 그룹 챌린지 진행률이 멤버마다 findByUserAndDate 를 돌지 않게 하는 용도
     * ({@code DailyFocusStatRepository.findByUserInAndDate} 의 스크린타임 짝).
     * 통계 행이 없는 유저는 결과에 없으므로 호출측이 "데이터 없음"(null)으로 다룬다.
     *
     * @param users 대상 유저들
     * @param date  KST 기준 날짜
     * @return 그날 보고가 있는 유저의 행만. 입력 유저 수보다 적을 수 있으므로 호출측이 빈자리를 메워야 한다
     */
    List<DailyScreenTimeStat> findByUserInAndDate(Collection<User> users, LocalDate date);

    /**
     * 기간 내 집계를 날짜 오름차순으로 읽는다.
     *
     * @param user 대상 유저
     * @param from 시작 날짜(포함, KST 기준)
     * @param to   종료 날짜(포함, KST 기준)
     * @return 보고가 있던 날의 행만 — 보고가 없던 날은 행 자체가 빠지므로 결과가 기간보다 짧을 수 있다
     */
    List<DailyScreenTimeStat> findByUserAndDateBetweenOrderByDateAsc(User user, LocalDate from, LocalDate to);

    /**
     * 탈퇴 처리에서 집계 행의 유저 참조만 끊는다 — 행 자체는 남겨 개인 식별만 제거한다.
     *
     * @param userId 탈퇴하는 유저
     */
    @Modifying
    @Query("UPDATE DailyScreenTimeStat d SET d.user = null WHERE d.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);
}

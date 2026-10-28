package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
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
 * KST 날짜별 집중 집계의 저장·조회 지점.
 *
 * <p>정상 종료 시 유효 집중 구간을 날짜 경계로 나눠 누적한다. 친구의 당일 집중 시간 조회도
 * 이 집계를 사용한다. 사용자·날짜의 유니크 제약과 갱신 잠금으로 중복 행과 갱신 유실을 막는다.
 */
public interface DailyFocusStatRepository extends JpaRepository<DailyFocusStat, UUID> {

    /**
     * @param user 집계의 주인
     * @param date 조회할 날짜(KST)
     * @return 그날 집계 행. 그날 집계가 없으면 빈 값이다
     */
    Optional<DailyFocusStat> findByUserAndDate(User user, LocalDate date);

    /**
     * UPDATE-UPDATE lost update 방지(누적 연산): 비관적 쓰기 잠금으로 동시 세션 저장 시 += 누락 차단
     * INSERT-INSERT 동시 삽입은 unique(user_id, date) 제약이 정합성 보장(오염 없음, 실패 건은 클라 재시도)
     *
     * @param user 집계의 주인
     * @param date 갱신할 날짜(KST)
     * @return 잠긴 집계 행. 트랜잭션이 끝날 때까지 같은 (user, date) 의 다른 누적 갱신은 대기한다.
     *         행이 아직 없으면 빈 값이고, 그때는 새로 넣는다 — 동시 삽입은 유니크 제약이 막는다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT d FROM DailyFocusStat d WHERE d.user = :user AND d.date = :date")
    Optional<DailyFocusStat> findByUserAndDateForUpdate(@Param("user") User user, @Param("date") LocalDate date);


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
     * userId 집합의 당일({@code date}) 집계를 배치 조회한다 (GROMO-822, FocusLiveInfoLookup 공용).
     *
     * @param userIds 집계를 볼 유저 id 들. 빈 컬렉션은 호출 전에 걸러야 한다
     * @param date    조회할 날짜(KST)
     * @return 행이 있는 유저의 집계만 — 요청한 수보다 적게 올 수 있다
     */
    @Query("SELECT d FROM DailyFocusStat d WHERE d.user.id IN :userIds AND d.date = :date")
    List<DailyFocusStat> findByUserIdInAndDate(@Param("userIds") Collection<UUID> userIds,
                                               @Param("date") LocalDate date);










}

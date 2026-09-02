package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserStreak;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 연속 집중 일수(스트릭) 행. PK 가 곧 유저 id 다.
 *
 * <p>스트릭은 <b>다음 세션에서 lazy reset</b> 된다 — 이미 끊긴 스트릭도 다시 집중할 때까지 예전 일수가
 * 그대로 남아 있다. 그래서 "살아 있는 스트릭"을 세려면 일수만 볼 게 아니라 마지막 세션 날짜를 함께 봐야 한다.
 */
public interface UserStreakRepository extends JpaRepository<UserStreak, UUID> {

    /**
     * 유저의 스트릭 단건 조회.
     *
     * @param user 조회 대상
     * @return 스트릭 행. 아직 한 번도 집중하지 않았으면 빈 값이고, 값이 있어도 <b>끊긴 스트릭일 수 있다</b>
     *         (일수는 다음 세션에서야 0으로 리셋된다)
     */
    Optional<UserStreak> findByUser(User user);

    /**
     * 스트릭 위기 알림(GROMO-841) — 아직 살아있는(오늘 이어갈 수 있는) 스트릭만 userId 키셋으로 페이지네이션.
     * 스트릭은 다음 세션에서 lazy reset 되므로, 이미 끊긴(마지막 세션이 그저께 이전) 유저도 streakCount 가
     * 양수로 남아있다 → lastSessionDate >= 어제 조건으로 그들을 제외해야 매일 밤 "끊길라" 헛 알림을 막는다.
     * 전체를 한 List 로 적재하지 않고 커서(userId)로 끊어 조회해, 대량 스트릭 보유자에서도
     * 메모리·트랜잭션 작업량을 페이지 단위로 제한한다(오늘 미집중 경로의 keyset 페이징과 동일 관례).
     *
     * @param threshold          이 값을 <b>초과</b>하는 스트릭만. 0을 넘기면 "1일 이상"이 된다
     * @param minLastSessionDate 마지막 세션이 이 날짜 이후여야 한다 — 보통 어제(KST).
     *                           이게 없으면 이미 끊긴 스트릭 보유자에게 "끊길라" 알림이 나간다
     * @param cursor             직전 페이지의 마지막 userId. null 이면 첫 페이지
     * @param pageable           size 만 쓴다(정렬은 쿼리에 박혀 있다)
     * @return userId 오름차순 한 페이지. 다음 커서는 호출측이 마지막 항목에서 뽑는다
     */
    @Query("SELECT s FROM UserStreak s "
            + "WHERE s.streakCount > :threshold AND s.lastSessionDate >= :minLastSessionDate "
            + "AND s.deletedAt IS NULL AND (:cursor IS NULL OR s.userId > :cursor) "
            + "ORDER BY s.userId ASC")
    List<UserStreak> findActiveStreakHoldersPage(@Param("threshold") int threshold,
                                                 @Param("minLastSessionDate") LocalDate minLastSessionDate,
                                                 @Param("cursor") UUID cursor,
                                                 Pageable pageable);
}

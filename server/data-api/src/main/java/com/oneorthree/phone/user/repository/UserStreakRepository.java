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

public interface UserStreakRepository extends JpaRepository<UserStreak, UUID> {

    Optional<UserStreak> findByUser(User user);

    /**
     * 스트릭 위기 알림(GROMO-841) — 아직 살아있는(오늘 이어갈 수 있는) 스트릭만 userId 키셋으로 페이지네이션.
     * 스트릭은 다음 세션에서 lazy reset 되므로, 이미 끊긴(마지막 세션이 그저께 이전) 유저도 streakCount 가
     * 양수로 남아있다 → lastSessionDate >= 어제 조건으로 그들을 제외해야 매일 밤 "끊길라" 헛 알림을 막는다.
     * 전체를 한 List 로 적재하지 않고 커서(userId)로 끊어 조회해, 대량 스트릭 보유자에서도
     * 메모리·트랜잭션 작업량을 페이지 단위로 제한한다(오늘 미집중 경로의 keyset 페이징과 동일 관례).
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

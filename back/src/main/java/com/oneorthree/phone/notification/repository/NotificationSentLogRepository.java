package com.oneorthree.phone.notification.repository;

import com.oneorthree.phone.notification.domain.NotificationSentLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 발송 이력 조회/저장 (GROMO-579).
 * 배치 시작 시 이번 주 RANK_OVERTAKE 로그를 유저 여러 명분 한 번에 로드해(N+1 금지),
 * 서비스가 in-memory 로 48h 쿨다운·주2회 상한을 판정한다.
 */
public interface NotificationSentLogRepository extends JpaRepository<NotificationSentLog, UUID> {

    // 이번 주(월 00:00 KST ~) 특정 type 발송 로그를 대상 유저 집합에 대해 일괄 조회.
    // 반환분으로 유저별 (주간 발송 횟수) 와 (라이벌별 최근 발송 시각) 을 모두 계산한다.
    @Query("SELECT l FROM NotificationSentLog l "
            + "WHERE l.type = :type AND l.userId IN :userIds AND l.sentAt >= :since")
    List<NotificationSentLog> findByTypeAndUserIdInSince(
            @Param("type") String type,
            @Param("userIds") List<UUID> userIds,
            @Param("since") Instant since);
}

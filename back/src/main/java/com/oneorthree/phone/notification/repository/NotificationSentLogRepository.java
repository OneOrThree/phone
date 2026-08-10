package com.oneorthree.phone.notification.repository;

import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 발송 이력 조회/저장 (GROMO-579).
 * 배치 시작 시 이번 주 RANK_OVERTAKE 로그를 유저 여러 명분 한 번에 로드해(N+1 금지),
 * 서비스가 in-memory 로 48h 쿨다운·주2회 상한을 판정한다.
 *
 * <p><b>V45 클레임 파이프라인(GROMO-1417, N41)</b> — 내기 사건 알림은 "조회 후 발송"이 아니라
 * <b>발송 전 선점</b>이다: {@link #insertPendingClaim} 이 사건 유니크
 * {@code (user_id, kind, subject_id)} 로 PENDING 행을 INSERT 하고(충돌 = 남이 선점 → 0 반환),
 * 리스(10분)가 만료된 PENDING 은 {@link #reclaimExpired} 가 회수한다 — 죽은 워커의 건이
 * 영구 미발송으로 남지 않는다.
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

    /**
     * 사건 클레임(선점) — 발송 <b>전에</b> PENDING 행을 INSERT 한다. 유니크
     * {@code (user_id, kind, subject_id)} 충돌이면 아무것도 하지 않는다(다른 워커가 이미 선점했거나
     * 이미 발송된 사건).
     *
     * @return 1 = 이 호출이 사건을 선점했다, 0 = 이미 선점·발송됨(리스 만료 회수는
     *     {@link #reclaimExpired} 로 별도 시도)
     */
    @Modifying
    @Transactional
    @Query(value = "INSERT INTO notification_sent_logs "
            + "(id, user_id, type, kind, subject_id, group_id, slot_at, status, claimed_at) "
            + "VALUES (:id, :userId, :kind, :kind, :subjectId, :groupId, :slotAt, 'PENDING', :claimedAt) "
            + "ON CONFLICT (user_id, kind, subject_id) DO NOTHING", nativeQuery = true)
    int insertPendingClaim(
            @Param("id") UUID id,
            @Param("userId") UUID userId,
            @Param("kind") String kind,
            @Param("subjectId") UUID subjectId,
            @Param("groupId") UUID groupId,
            @Param("slotAt") Instant slotAt,
            @Param("claimedAt") Instant claimedAt);

    /**
     * 리스 만료 PENDING 재클레임 — 선점 후 SENT 마킹(또는 삭제) 전에 죽은 워커의 건을 회수한다.
     * claimed_at 이 컷오프(now − 10분)보다 오래된 PENDING 만 잡는다. DEFERRED(이월 대기)는
     * 죽은 클레임이 아니라 발송 대기라 대상이 아니다.
     *
     * @return 1 = 재클레임 성공(이 호출이 소유), 0 = 남의 리스가 살아 있거나 이미 종결됨
     */
    @Modifying
    @Transactional
    @Query("UPDATE NotificationSentLog l SET l.claimedAt = :now "
            + "WHERE l.userId = :userId AND l.kind = :kind AND l.subjectId = :subjectId "
            + "AND l.status = com.oneorthree.phone.notification.domain.NotificationSendStatus.PENDING "
            + "AND l.claimedAt < :cutoff")
    int reclaimExpired(
            @Param("userId") UUID userId,
            @Param("kind") String kind,
            @Param("subjectId") UUID subjectId,
            @Param("cutoff") Instant cutoff,
            @Param("now") Instant now);

    /** 사건 클레임 행 단건 — 재클레임 성공 후 행 id·묶음 메타를 다시 읽는 용도. */
    Optional<NotificationSentLog> findByUserIdAndKindAndSubjectId(UUID userId, String kind, UUID subjectId);

    /** 이월 대기(DEFERRED) 전량 — 07:00 및 주기 틱의 flush 대상(N44). */
    List<NotificationSentLog> findByStatus(NotificationSendStatus status);

    /**
     * 클레임 종결 — 발송 성사(SENT + 실발송 시각) 또는 이월(DEFERRED, sentAt null 유지) 마킹.
     * 벌크 UPDATE 라 영속성 컨텍스트를 우회한다 — 호출 후 같은 트랜잭션에서 해당 엔티티의
     * status 를 읽지 말 것.
     */
    @Modifying
    @Transactional
    @Query("UPDATE NotificationSentLog l SET l.status = :status, l.sentAt = :sentAt WHERE l.id IN :ids")
    int updateStatusByIds(
            @Param("ids") Collection<UUID> ids,
            @Param("status") NotificationSendStatus status,
            @Param("sentAt") Instant sentAt);

    /**
     * 클레임 반납 — FCM 실패·필터 스킵 건의 PENDING 행을 지워 재훑기(48h lookback)가 다시 집게
     * 한다. 이미 나간 푸시는 회수할 수 없지만, 안 나간 사건의 선점을 쥔 채 죽는 것은 막아야 한다.
     */
    @Modifying
    @Transactional
    @Query("DELETE FROM NotificationSentLog l WHERE l.id IN :ids")
    int deleteByIds(@Param("ids") Collection<UUID> ids);
}

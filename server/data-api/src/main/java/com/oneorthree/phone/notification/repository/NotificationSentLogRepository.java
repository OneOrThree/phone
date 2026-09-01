package com.oneorthree.phone.notification.repository;

import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
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

    /**
     * 이번 주(월 00:00 KST ~) 특정 type 발송 로그를 대상 유저 집합에 대해 일괄 조회.
     * 반환분으로 유저별 (주간 발송 횟수) 와 (라이벌별 최근 발송 시각) 을 모두 계산한다.
     */
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
            + "AND l.status = com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.PENDING "
            + "AND l.claimedAt < :cutoff")
    int reclaimExpired(
            @Param("userId") UUID userId,
            @Param("kind") String kind,
            @Param("subjectId") UUID subjectId,
            @Param("cutoff") Instant cutoff,
            @Param("now") Instant now);

    /**
     * <b>미발송 클레임 소비</b> — 사용자가 인앱에서 그 사건을 이미 확인해 푸시를 보낼 이유가 사라진
     * 경우, 아직 안 나간 {@code PENDING}·{@code DEFERRED} 클레임을 {@code SENT}(소비 확정)로 닫는다
     * (GROMO-1577 · policy B17).
     *
     * <p>결과 모달 ack 이 첫 사용처다. 15분 묶음 슬롯이 닫히기 전이나 조용한 시간 이월(N44) 중에
     * 사용자가 조회로 먼저 결과를 보고 ack 하면, 이걸 닫지 않는 한 <b>이미 본 결과의 푸시가 나중에
     * 도착</b>하고 탭하면 결과 없이 그룹방만 열린다.
     *
     * <p><b>삭제가 아니라 {@code SENT} 인 이유</b>: 지우면 48시간 재훑기가 같은 사건을 다시 선점해
     * 푸시가 되살아난다. {@code SENT} 는 이 파이프라인에서 "다시 나가지 않음"을 뜻하고,
     * 재조립 불가 건을 소비 확정할 때 이미 같은 방식을 쓰고 있다({@code flushClaims}).
     * 이미 발송된({@code SENT}) 건은 조건에서 빠져 {@code sent_at} 이 덮이지 않는다.
     *
     * @return 닫은 클레임 수(0 = 애초에 없었거나 이미 발송·소비됨)
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE NotificationSentLog l SET "
            + "l.status = com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.SENT, "
            + "l.sentAt = :now, l.nextAttemptAt = null "
            + "WHERE l.userId = :userId AND l.kind = :kind AND l.subjectId = :subjectId "
            + "AND l.status IN ("
            + "com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.PENDING, "
            + "com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.DEFERRED)")
    int consumeUnsentClaims(
            @Param("userId") UUID userId,
            @Param("kind") String kind,
            @Param("subjectId") UUID subjectId,
            @Param("now") Instant now);

    /** 사건 클레임 행 단건 — 재클레임 성공 후 행 id·묶음 메타를 다시 읽는 용도. */
    Optional<NotificationSentLog> findByUserIdAndKindAndSubjectId(UUID userId, String kind, UUID subjectId);

    /** 이월 대기(DEFERRED) 전량 — 진단·테스트용. 발송 경로는 {@link #findDueClaimsForUpdate} 를 쓴다. */
    List<NotificationSentLog> findByStatus(NotificationSendStatus status);

    /**
     * 발송할 차례가 된 클레임을 <b>원자적으로 선점</b>해 가져온다(GROMO-1417 · N20 · N44).
     * 두 부류를 한 번에 집는다:
     * <ul>
     *   <li>{@code PENDING} 중 <b>슬롯이 닫힌</b> 것 — 같은 슬롯에 사건이 더 붙을 여지가 없어졌으므로
     *       이제 묶어서 보낸다. 이벤트 경로가 사건마다 즉시 보내면 같은 슬롯·같은 그룹의 회차 수만큼
     *       푸시가 나가고, 이미 {@code SENT} 인 클레임은 재훑기가 다시 묶을 수 없다(N20 파기).</li>
     *   <li>{@code DEFERRED} — 조용한 시간 이월분 중 <b>다음 시도 시각이 도래한</b> 것만(N44).
     *       실제 발송 가부는 유저별 quiet hours 로 다시 본다.</li>
     * </ul>
     *
     * <p><b>{@code next_attempt_at} 필터가 없으면</b> 조용한 시간 내내 같은 {@code DEFERRED} 전량을
     * 5분마다 다시 잠그고 회차·참가자·설정을 재조회한 뒤 {@code DEFERRED} 로 되돌려 쓴다 —
     * 자정 정산분은 07:00 까지 하루형 참가자당 최대 84회다. 불필요한 행 잠금·WAL 쓰기에 더해,
     * 대상이 많으면 그 틱에 실제로 보내야 할 새 클레임까지 뒤로 밀린다.</p>
     *
     * <p><b>{@code FOR UPDATE SKIP LOCKED}</b>(락 타임아웃 힌트 {@code -2} = Hibernate
     * {@code SKIP_LOCKED}) — 크론과 수동 트리거가 겹쳐도 한 워커만 같은 행을 가져간다. 이게 없으면
     * 둘 다 같은 이월 알림을 읽어 <b>중복 도착</b>한다. 잠금은 트랜잭션 종료까지라, 워커가 죽으면
     * 롤백돼 다음 틱이 그대로 회수한다.
     *
     * @param kinds            이 서비스가 소유한 kind 만(다른 트리거의 클레임을 훔치지 않는다)
     * @param slotClosedBefore 이 시각 이하의 슬롯만 발송 대상 — 크론은 {@code now − 슬롯폭},
     *                         수동 트리거는 {@code now}(즉시 확인용)를 넘긴다
     * @param now              이월분의 도래 판정 기준 — {@code next_attempt_at} 이 이 시각 이하인
     *                         것만 집는다({@code null} 은 시각 미기록 = 즉시 대상)
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("SELECT l FROM NotificationSentLog l WHERE l.kind IN :kinds AND ("
            + "(l.status = com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.DEFERRED "
            + "AND (l.nextAttemptAt IS NULL OR l.nextAttemptAt <= :now)) "
            + "OR (l.status = com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.PENDING "
            + "AND l.slotAt <= :slotClosedBefore)) ORDER BY l.slotAt, l.id")
    List<NotificationSentLog> findDueClaimsForUpdate(
            @Param("kinds") Collection<String> kinds,
            @Param("slotClosedBefore") Instant slotClosedBefore,
            @Param("now") Instant now);

    /**
     * 이월(DEFERRED) 중 <b>다음 시도 시각이 도래한</b> 클레임만 원자 선점해 가져온다 —
     * 모집 알림처럼 {@code PENDING} 을 같은 틱 안에서 소비하는 트리거용이다(GROMO-1417 · N44).
     *
     * <p>{@link #findDueClaimsForUpdate} 를 쓰지 않는 이유: 그 쪽은 슬롯이 닫힌 {@code PENDING} 도
     * 함께 집는데, 모집은 스캔이 방금 INSERT 한 {@code PENDING} 이 같은 트랜잭션에 살아 있어
     * <b>같은 행을 두 번</b> 처리하게 된다(스캔 경로 + 이월 경로 = 이중 발송).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("SELECT l FROM NotificationSentLog l WHERE l.kind IN :kinds "
            + "AND l.status = com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.DEFERRED "
            + "AND (l.nextAttemptAt IS NULL OR l.nextAttemptAt <= :now) ORDER BY l.slotAt, l.id")
    List<NotificationSentLog> findDueDeferredClaimsForUpdate(
            @Param("kinds") Collection<String> kinds,
            @Param("now") Instant now);

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
     * 클레임 이월(N44) — 조용한 시간에 걸린 표시 푸시를 {@code DEFERRED} 로 두고 <b>다음 시도
     * 시각</b>(그 유저의 조용한 시간 종료 시각)을 함께 박는다. 이 시각이 없으면 flush 가 매 틱
     * 같은 집합을 다시 처리한다({@link #findDueClaimsForUpdate} 주석 참조).
     *
     * <p>{@code sent_at} 은 null 로 되돌린다 — 아직 발송 전이라는 사실이 상태와 어긋나면 안 된다.
     */
    @Modifying
    @Transactional
    @Query("UPDATE NotificationSentLog l SET "
            + "l.status = com.oneorthree.phone.notification.repository.domain.NotificationSendStatus.DEFERRED, "
            + "l.sentAt = null, l.nextAttemptAt = :nextAttemptAt WHERE l.id IN :ids")
    int deferByIds(
            @Param("ids") Collection<UUID> ids,
            @Param("nextAttemptAt") Instant nextAttemptAt);

    /**
     * 클레임 반납 — FCM 실패·필터 스킵 건의 PENDING 행을 지워 재훑기(48h lookback)가 다시 집게
     * 한다. 이미 나간 푸시는 회수할 수 없지만, 안 나간 사건의 선점을 쥔 채 죽는 것은 막아야 한다.
     */
    @Modifying
    @Transactional
    @Query("DELETE FROM NotificationSentLog l WHERE l.id IN :ids")
    int deleteByIds(@Param("ids") Collection<UUID> ids);
}

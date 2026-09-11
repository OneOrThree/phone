package com.oneorthree.phone.outbox.repository;

import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 대상별 전달 상태의 선점·완료·실패 (A21).
 *
 * <p><b>선점과 완료가 같은 토큰으로 묶인다.</b> {@link #claimBatch} 가 새 {@code leaseToken} 을 박고,
 * {@link #markDelivered}·{@link #markFailed} 는 그 토큰이 일치할 때만 0행이 아닌 결과를 낸다 —
 * 리스가 만료돼 남이 재클레임한 뒤 옛 워커가 뒤늦게 완료를 보고하면 조용히 무시된다(펜싱).
 *
 * <p><b>{@code @Modifying} 메서드는 트랜잭션을 열지 않는다</b>(규약 §4) — 호출측이
 * {@code @Transactional} 안에 있는지 확인할 책임을 진다.
 */
public interface EventOutboxDeliveryRepository extends JpaRepository<EventOutboxDelivery, UUID> {

    /**
     * 한 대상의 미전달 행을 리스로 선점한다.
     *
     * <h2>왜 이 {@code NOT EXISTS} 가 필수인가</h2>
     * relay 는 <b>같은 순서 축의 선행 미전달을 건너뛰면 안 된다</b>(A21). 건너뛰면 앞 사건이 재시도되는
     * 동안 뒤 사건이 먼저 도착해 {@code user_snapshot}·{@code bet_participations} 가 과거 상태로
     * 되돌아간다 — {@code key=userId} 는 브로커 <b>도착 순서</b>만 보존하고 {@code eventId} dedup 은
     * 역순 적용을 못 막는다. 그래서 같은 {@code (target, aggregate)} 에 더 낮은 version 의 미전달이
     * 남아 있으면 이 행은 후보에서 빠진다. 앞 행이 <b>남의 리스에 잡혀 있어도</b> 여전히 미전달이므로
     * 앞지르기가 성립하지 않는다.
     *
     * <p>{@code SKIP LOCKED} 는 <b>다른 축</b>의 행을 기다리지 않기 위한 것이다 — 한 축이 막혀도 나머지
     * 축은 계속 나간다.
     *
     * <p>{@code attempt_count} 는 선점 시점에 증가한다. 죽은 워커의 시도도 세어야 「몇 번째부터
     * 이상한가」가 보인다 — 성공 시에만 세면 영원히 0 이다.
     *
     * @param target     전달 대상 이름({@code OutboxTarget.name()})
     * @param now        현재 시각 — 도래 판정과 만료 리스 회수의 기준
     * @param leaseUntil 이번 리스의 만료 시각
     * @param owner      워커 식별자(로그·관측용)
     * @param token      펜싱 토큰 — 완료·실패 표시가 이 값을 제시해야 반영된다
     * @param batchSize  한 번에 집을 최대 건수
     * @return 선점한 행 수
     */
    @Modifying
    @Query(value = "UPDATE event_outbox_deliveries d "
            + "SET lease_owner = :owner, lease_token = :token, lease_expires_at = :leaseUntil, "
            + "    attempt_count = d.attempt_count + 1, last_attempt_at = :now "
            + "WHERE d.id IN ( "
            + "  SELECT c.id FROM event_outbox_deliveries c "
            + "  WHERE c.target = :target "
            + "    AND c.delivered_at IS NULL "
            + "    AND c.next_attempt_at <= :now "
            + "    AND (c.lease_expires_at IS NULL OR c.lease_expires_at <= :now) "
            + "    AND NOT EXISTS ( "
            + "      SELECT 1 FROM event_outbox_deliveries p "
            + "      WHERE p.target = c.target "
            + "        AND p.aggregate_type = c.aggregate_type "
            + "        AND p.aggregate_id = c.aggregate_id "
            + "        AND p.delivered_at IS NULL "
            + "        AND p.aggregate_version < c.aggregate_version) "
            + "  ORDER BY c.next_attempt_at, c.created_at, c.id "
            + "  LIMIT :batchSize "
            + "  FOR UPDATE SKIP LOCKED)", nativeQuery = true)
    int claimBatch(
            @Param("target") String target,
            @Param("now") Instant now,
            @Param("leaseUntil") Instant leaseUntil,
            @Param("owner") String owner,
            @Param("token") UUID token,
            @Param("batchSize") int batchSize);

    /**
     * 방금 선점한 행들을 읽는다 — {@link #claimBatch} 직후 같은 트랜잭션에서.
     *
     * @param token 이번 선점의 펜싱 토큰
     * @return 이 워커가 소유한 미전달 행들
     */
    @Query("SELECT d FROM EventOutboxDelivery d WHERE d.leaseToken = :token AND d.deliveredAt IS NULL "
            + "ORDER BY d.aggregateType, d.aggregateId, d.aggregateVersion")
    List<EventOutboxDelivery> findLeased(@Param("token") UUID token);

    /**
     * 전달 완료 표시 — <b>토큰이 일치할 때만</b>.
     *
     * <p>여기가 at-least-once 의 이음매다. 발행에 성공하고 이 표시에 실패하면(프로세스 종료·DB 순단)
     * 다음 틱이 같은 행을 다시 보내므로 <b>중복이 난다</b>. 수신 측은 전부 {@code eventId} 멱등이라
     * 안전하다 — 반대로 표시를 먼저 하면 그 사이 죽었을 때 <b>유실</b>이고, 그건 복구할 수 없다.
     *
     * @param id    전달 행
     * @param token 선점 때 받은 펜싱 토큰
     * @param now   완료 시각
     * @return 1 = 표시됨, 0 = 리스를 이미 잃었다(낡은 완료 보고 — 무시한다)
     */
    @Modifying
    @Query("UPDATE EventOutboxDelivery d SET d.deliveredAt = :now, d.lastError = NULL, "
            + "d.leaseOwner = NULL, d.leaseToken = NULL, d.leaseExpiresAt = NULL "
            + "WHERE d.id = :id AND d.leaseToken = :token AND d.deliveredAt IS NULL")
    int markDelivered(@Param("id") UUID id, @Param("token") UUID token, @Param("now") Instant now);

    /**
     * 실패를 기록하고 리스를 놓는다 — <b>토큰이 일치할 때만</b>.
     *
     * <p><b>행을 지우지 않는다.</b> 최종 재시도 기간·고갈 처리는 A18 보류라, 여기서 임의로 폐기하면
     * 보류된 정책을 코드가 먼저 정해 버린다. 고갈은 {@code attempt_count} 로 관측할 뿐이다.
     *
     * @param id        전달 행
     * @param token     선점 때 받은 펜싱 토큰
     * @param nextAt    다음 시도 시각(백오프)
     * @param error     마지막 오류 요약
     * @return 1 = 기록됨, 0 = 리스를 이미 잃었다
     */
    @Modifying
    @Query("UPDATE EventOutboxDelivery d SET d.nextAttemptAt = :nextAt, d.lastError = :error, "
            + "d.leaseOwner = NULL, d.leaseToken = NULL, d.leaseExpiresAt = NULL "
            + "WHERE d.id = :id AND d.leaseToken = :token AND d.deliveredAt IS NULL")
    int markFailed(
            @Param("id") UUID id,
            @Param("token") UUID token,
            @Param("nextAt") Instant nextAt,
            @Param("error") String error);

    /**
     * <b>빠른 완료표시</b> — 직접 전달에 성공한 호출자가 알림 대상 행 하나를 닫는다 (㊿).
     *
     * <h2>왜 「소유 검증 + 대상 고정」이 SQL 안에 있는가</h2>
     * 서비스 코드에서 조회해 검사한 뒤 갱신하면 그 사이에 조건이 바뀔 수 있고, 무엇보다 <b>검사를
     * 빠뜨린 호출 경로가 하나만 생겨도</b> 남의 전달을 닫을 수 있게 된다. 그래서 조건을 문장에 박는다:
     * <ul>
     *   <li>{@code e.userId = :userId} — 봉투의 수신자가 요청자여야 한다. 다른 유저의 명령 id 를
     *       찔러도 0행이다.
     *   <li>{@code target = NOTI} — <b>파라미터가 아니다</b>. 대상이 인자면 같은 경로로 Kafka·링크
     *       전달까지 「보냈다」고 표시할 수 있다.
     *   <li>{@code deliveredAt IS NULL} — 이미 닫힌 행을 다시 쓰지 않는다(표시 시각이 뒤로 밀린다).
     * </ul>
     *
     * <h2>relay 와 겹쳐도 안전하다</h2>
     * 리스가 살아 있는 행도 닫는다. 그 relay 워커가 나중에 {@link #markDelivered}·{@link #markFailed}
     * 를 부르면 둘 다 {@code deliveredAt IS NULL} 조건에 걸려 <b>0행</b>이다 — 즉 낡은 relay 의
     * 성공·실패 표시가 이 결과를 덮지 못한다(펜싱 유지). 그 사이 relay 가 이미 한 번 더 보냈다면
     * 중복이지만, 수신 측이 {@code eventId} 멱등이라 안전하다.
     *
     * <p>리스를 비우는 것도 의도다 — 닫힌 행에 남은 리스는 「누가 아직 붙잡고 있다」는 거짓 신호다.
     *
     * @param outboxId 봉투 id — 호출자가 명령 응답으로 받은 값
     * @param userId   인증된 요청자
     * @param now      완료 시각
     * @return 1 = 이 호출이 닫았다, 0 = 대상이 없거나 남의 것이거나 이미 닫혔다
     */
    @Modifying
    @Query("UPDATE EventOutboxDelivery d SET d.deliveredAt = :now, d.lastError = NULL, "
            + "d.leaseOwner = NULL, d.leaseToken = NULL, d.leaseExpiresAt = NULL "
            + "WHERE d.outboxId = :outboxId AND d.deliveredAt IS NULL "
            + "AND d.target = com.oneorthree.phone.outbox.repository.domain.OutboxTarget.NOTI "
            + "AND EXISTS (SELECT 1 FROM EventOutbox e WHERE e.id = d.outboxId AND e.userId = :userId)")
    int markNotificationDeliveredByOwner(
            @Param("outboxId") UUID outboxId,
            @Param("userId") UUID userId,
            @Param("now") Instant now);

    /**
     * 소유가 확인된 알림 전달 행 — 빠른 완료표시가 0행일 때 「없음」과 「이미 닫힘」을 가른다.
     *
     * <p>같은 소유·대상 조건을 반복하는 것이 중복처럼 보이지만, 이 조회에도 조건이 없으면 호출부가
     * 남의 행을 보고 「이미 닫혔다」를 알려 주게 된다 — 그 자체가 존재 노출이다.
     *
     * @param outboxId 봉투 id
     * @param userId   인증된 요청자
     * @return 요청자의 알림 전달 행
     */
    @Query("SELECT d FROM EventOutboxDelivery d "
            + "WHERE d.outboxId = :outboxId "
            + "AND d.target = com.oneorthree.phone.outbox.repository.domain.OutboxTarget.NOTI "
            + "AND EXISTS (SELECT 1 FROM EventOutbox e WHERE e.id = d.outboxId AND e.userId = :userId)")
    Optional<EventOutboxDelivery> findOwnedNotificationDelivery(
            @Param("outboxId") UUID outboxId,
            @Param("userId") UUID userId);

    /**
     * @param outboxId 봉투
     * @return 그 봉투의 대상별 전달 행 전부
     */
    List<EventOutboxDelivery> findByOutboxId(UUID outboxId);

    /**
     * @param outboxId 봉투
     * @param target   전달 대상
     * @return 그 봉투의 해당 대상 전달 행
     */
    Optional<EventOutboxDelivery> findByOutboxIdAndTarget(UUID outboxId, OutboxTarget target);
}

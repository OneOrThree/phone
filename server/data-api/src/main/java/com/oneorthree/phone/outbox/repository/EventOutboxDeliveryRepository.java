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
     * 한 대상의 미전달 행을 리스로 선점하고 <b>선점한 행을 그대로 돌려준다</b>({@code UPDATE … RETURNING}).
     *
     * <h2>왜 선행 미전달 검사가 필수인가</h2>
     * relay 는 <b>같은 순서 축의 선행 미전달을 건너뛰면 안 된다</b>(A21). 건너뛰면 앞 사건이 재시도되는
     * 동안 뒤 사건이 먼저 도착해 {@code user_snapshot}·{@code bet_participations} 가 과거 상태로
     * 되돌아간다 — {@code key=userId} 는 브로커 <b>도착 순서</b>만 보존하고 {@code eventId} dedup 은
     * 역순 적용을 못 막는다. 그래서 같은 {@code (target, aggregate)} 에 더 낮은 version 의 미전달이
     * 남아 있으면 이 행은 후보에서 빠진다. 앞 행이 <b>남의 리스에 잡혀 있어도</b> 여전히 미전달이므로
     * 앞지르기가 성립하지 않는다.
     *
     * <p>추가로 Kafka 후보는 같은 축의 선행 NOTI HTTP 완료를 기다린다. 설정 끔·기기 삭제·세션
     * 폐기의 DB 커밋 응답 전에 후행 알림이 브로커로 나가면 이전 상태로 발송될 수 있기 때문이다.
     * 역방향은 기다리지 않는다. Kafka 완료는 브로커 ACK이지 소비 완료가 아니며, 최신 끔·삭제를
     * 브로커 지연에 묶어 두면 보호가 늦어진다. 늦게 소비된 요청은 발송 시 최신 상태를 대조한다.
     * LINK는 이 장벽과 독립이다.
     *
     * <h2>상관 서브쿼리 대신 윈도 한 번 (GROMO-2337)</h2>
     * 예전 문장은 후보 행마다 {@code NOT EXISTS} 로 선행을 찔러 백로그 2만 건에서 선점 한 번이 1초를
     * 넘었다. 지금은 축({@code aggregate_type, aggregate_id})별로 {@code aggregate_version, target} 순서로
     * 한 번 훑으며 {@code ready} = 「축 첫 행부터 이 행까지 <b>전부</b> 지금 선점 가능」(누적 AND)을 구한다.
     * 이 대상이 아닌 행(KAFKA 축의 NOTI)과 리스·백오프 중인 행은 {@code ready} 가 거짓이라 그 뒤를 전부
     * 막는다 — 위 두 장벽과 같은 의미다. 같은 version 의 NOTI 는 {@code 'KAFKA' < 'NOTI'} 정렬로 KAFKA 뒤에
     * 와서 막지 않는다(예전 {@code <} 비교와 같다). {@code pos <= runLength} 가 축에서 집을 앞쪽 연속 길이다.
     *
     * <p>바깥 {@code l} 의 도래·리스 조건은 중복처럼 보이지만 <b>지우면 이중 선점</b>이다. 다른 워커가 이 문장의
     * 스냅샷 뒤에 같은 행을 선점·커밋하면, 잠금을 얻은 뒤 PostgreSQL 은 잠근 테이블의 조건만 최신 행으로
     * 재평가한다 — 그 재평가가 「이미 남의 리스」를 걸러 낸다. 잠금 뒤 {@code LIMIT} 이라 {@code SKIP LOCKED}
     * 로 건너뛴 만큼 다음 후보로 채운다.
     *
     * <p>{@code attempt_count} 는 선점 시점에 증가한다. 죽은 워커의 시도도 세어야 「몇 번째부터
     * 이상한가」가 보인다 — 성공 시에만 세면 영원히 0 이다.
     *
     * <p>{@code @Modifying} 이 아니다 — 결과 집합을 돌려주는 문장이라 select 로 실행한다. 쓰기이므로
     * 호출측이 읽기·쓰기 트랜잭션 안에 있어야 한다.
     *
     * <p><b>캐시 주의:</b> 네이티브 쿼리가 엔티티를 돌려주므로 같은 영속성 컨텍스트에 이미 로드된
     * {@code EventOutboxDelivery} 가 있으면 RETURNING 값이 아니라 캐시 인스턴스가 올 수 있다 — 반드시 자기
     * 트랜잭션({@code OutboxRelayStore.claim})에서만 부른다.
     *
     * <p><b>가정:</b> 한 축 안에서 (target, aggregate_version) 은 유일하다 — 같은 version 의 같은 target 행이
     * 둘이면 윈도 순서가 불안정하다. 근거: 봉투 {@code uq_event_outbox_aggregate_version
     * (aggregate_type, aggregate_id, version)} 와 전달 행 {@code uq_event_outbox_deliveries_outbox_target
     * (outbox_id, target)} 두 UNIQUE 인덱스(V51)가 합쳐 보장한다.
     *
     * @param target     전달 대상 이름({@code OutboxTarget.name()})
     * @param now        현재 시각 — 도래 판정과 만료 리스 회수의 기준
     * @param leaseUntil 이번 리스의 만료 시각
     * @param owner      워커 식별자(로그·관측용)
     * @param token      펜싱 토큰 — 완료·실패 표시가 이 값을 제시해야 반영된다
     * @param runLength  축마다 앞에서부터 집을 최대 연속 건수
     * @param batchSize  한 번에 집을 최대 건수
     * @return 선점한 행 — {@code aggregateType, aggregateId, aggregateVersion} 순
     */
    @Query(value = "WITH claimed AS ( "
            + "  UPDATE event_outbox_deliveries d "
            + "     SET lease_owner = :owner, lease_token = :token, lease_expires_at = :leaseUntil, "
            + "         attempt_count = d.attempt_count + 1, last_attempt_at = :now "
            + "   WHERE d.id IN ( "
            + "     SELECT l.id "
            + "       FROM event_outbox_deliveries l "
            + "       JOIN (SELECT c.id, c.target, "
            + "                    row_number() OVER axis AS pos, "
            + "                    bool_and(c.target = :target AND c.next_attempt_at <= :now "
            + "                             AND (c.lease_expires_at IS NULL OR c.lease_expires_at <= :now)) "
            + "                      OVER axis AS ready "
            + "               FROM event_outbox_deliveries c "
            + "              WHERE c.delivered_at IS NULL "
            + "                AND (c.target = :target OR (:target = 'KAFKA' AND c.target = 'NOTI')) "
            + "             WINDOW axis AS (PARTITION BY c.aggregate_type, c.aggregate_id "
            + "                             ORDER BY c.aggregate_version, c.target "
            + "                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) w "
            + "         ON w.id = l.id "
            + "      WHERE w.ready AND w.target = :target AND w.pos <= :runLength "
            + "        AND l.delivered_at IS NULL AND l.next_attempt_at <= :now "
            + "        AND (l.lease_expires_at IS NULL OR l.lease_expires_at <= :now) "
            + "      ORDER BY w.pos, l.next_attempt_at, l.created_at, l.id "
            + "      LIMIT :batchSize "
            + "      FOR UPDATE OF l SKIP LOCKED) "
            + "  RETURNING d.*) "
            + "SELECT * FROM claimed ORDER BY aggregate_type, aggregate_id, aggregate_version",
            nativeQuery = true)
    List<EventOutboxDelivery> claimBatch(
            @Param("target") String target,
            @Param("now") Instant now,
            @Param("leaseUntil") Instant leaseUntil,
            @Param("owner") String owner,
            @Param("token") UUID token,
            @Param("runLength") int runLength,
            @Param("batchSize") int batchSize);

    /**
     * 대상별 미전달 스냅샷 — relay 지표(backlog·oldest_pending_age)용, 틱마다 한 번.
     *
     * <p>나이는 <b>도래한 행</b>({@code next_attempt_at <= now})만 본다. 백오프로 미뤄 둔 행까지 세면
     * 「밀렸다」와 「일부러 기다린다」가 구분되지 않는다.
     *
     * @param now 기준 시각
     * @return 행마다 {@code [target, 미전달 수, 가장 오래된 도래 행의 나이(초, 없으면 null)]}
     */
    @Query(value = "SELECT target, count(*), "
            + "  CAST(EXTRACT(EPOCH FROM CAST(:now AS timestamptz) "
            + "       - min(created_at) FILTER (WHERE next_attempt_at <= :now)) AS bigint) "
            + "FROM event_outbox_deliveries WHERE delivered_at IS NULL GROUP BY target", nativeQuery = true)
    List<Object[]> pendingSnapshot(@Param("now") Instant now);

    /**
     * 전송 직전 살아 있는 자기 리스만 갱신한다. 만료 토큰은 재선점 전까지 부활시키지 않는다.
     *
     * @param id 전달 행
     * @param token 선점 때 받은 펜싱 토큰
     * @param now 갱신 시각
     * @param leaseUntil 새 만료 시각
     * @return 1 = 갱신됨, 0 = 만료·소유권 상실·이미 완료됨
     */
    @Modifying
    @Query("UPDATE EventOutboxDelivery d SET d.leaseExpiresAt = :leaseUntil "
            + "WHERE d.id = :id AND d.leaseToken = :token AND d.deliveredAt IS NULL "
            + "AND d.leaseExpiresAt > :now")
    int renewLease(
            @Param("id") UUID id,
            @Param("token") UUID token,
            @Param("now") Instant now,
            @Param("leaseUntil") Instant leaseUntil);

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
     * 탈퇴자 봉투의 전달 본문에서 개인정보 한 필드를 JSON null 로 대체한다 (GROMO-1946 · 계정 LLD §4).
     *
     * <p><b>「다시 나가지 않는다」가 확실한 행만 고친다.</b> 소비자는 {@code eventId} 로 dedup 하고 일부는 본문
     * 해시까지 대조한다(알림 {@code EVENT_ID_CONFLICT}). 이미 한 번 보낸 본문을 바꿔 재전달하면 4xx 영구 실패가 되고,
     * relay 는 고갈 처리가 없어(A18) 그 축의 뒤 사건 — 탈퇴의 링크 폐기까지 — 가 영원히 막힌다. 그래서:
     * <ul>
     *   <li>전달 완료 행 — 다시 보내지 않는다. 기록일 뿐이라 고쳐도 아무 데도 안 나간다.</li>
     *   <li>한 번도 선점되지 않은 행({@code attempt_count=0} · 리스 없음) — 첫 전송이 고친 본문으로 나간다.
     *       단 NOTI 는 relay 밖 직접 전달 경로(㊿)가 있어 시도 수로 「안 나갔다」를 판정할 수 없으므로 뺀다.</li>
     *   <li>그 밖(시도했지만 미완료) — 같은 본문으로 다시 나가야 하므로 그대로 둔다.</li>
     * </ul>
     * 동시 선점과는 행 잠금으로 직렬화된다 — 이 UPDATE 가 먼저 잡으면 relay 는 {@code SKIP LOCKED} 로 건너뛰고
     * 커밋 뒤 고친 본문을 읽는다. relay 가 먼저 잡았으면 커밋 뒤 조건을 다시 평가해 {@code attempt_count>0} 로 빠진다.
     *
     * @param userId   봉투 주체(탈퇴자)
     * @param type     사건 종류
     * @param paramKey 대체할 {@code params} 키
     * @return 고친 전달 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE event_outbox_deliveries d "
            + "SET payload = jsonb_set(d.payload, ARRAY['params', CAST(:paramKey AS text)], CAST('null' AS jsonb)) "
            + "FROM event_outbox o "
            + "WHERE d.outbox_id = o.id AND o.user_id = :userId AND o.type = :type "
            + "  AND jsonb_exists(d.payload -> 'params', :paramKey) "
            + "  AND (d.delivered_at IS NOT NULL "
            + "       OR (d.attempt_count = 0 AND d.lease_token IS NULL AND d.target <> 'NOTI'))",
            nativeQuery = true)
    int eraseParamOfResendSafe(
            @Param("userId") UUID userId,
            @Param("type") String type,
            @Param("paramKey") String paramKey);

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

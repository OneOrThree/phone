package com.oneorthree.phone.outbox.repository;

import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersionId;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;

/**
 * 순서용 version 발급구 (㊸).
 *
 * <p><b>락 등급이 이 저장소의 계약이다</b>(규약 §3 ①). 무락 조회를 두지 않는 것은 의도다 — 이
 * 테이블을 읽는 이유는 오직 「다음 번호를 발급한다」뿐이고, 잠그지 않고 읽으면 두 트랜잭션이 같은
 * 번호를 만들어 {@code uq_event_outbox_aggregate_version} 이 둘 중 하나를 죽인다.
 */
public interface AggregateVersionRepository extends JpaRepository<AggregateVersion, AggregateVersionId> {

    /**
     * 발급용 배타 잠금 조회 — <b>반드시 {@code @Transactional} 안에서</b>. 밖에서 부르면 잠금이 즉시
     * 풀려 아무 일도 하지 않은 것과 같다.
     *
     * @param aggregateType 순서 축의 종류
     * @param aggregateId   순서 축의 식별자
     * @return 있으면 잠긴 행. 첫 발급이면 비어 있다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM AggregateVersion a "
            + "WHERE a.aggregateType = :aggregateType AND a.aggregateId = :aggregateId")
    Optional<AggregateVersion> findForUpdate(
            @Param("aggregateType") String aggregateType,
            @Param("aggregateId") String aggregateId);

    /**
     * 첫 행을 만든다 — 이미 있으면 아무것도 하지 않는다.
     *
     * <p>{@code save()} 가 아니라 {@code ON CONFLICT DO NOTHING} 인 이유: 같은 축의 첫 명령 둘이
     * 동시에 오면 {@code save()} 는 한쪽을 UNIQUE 위반으로 죽인다(그 예외는 트랜잭션을 오염시켜
     * 재시도도 못 한다). 이 문장은 <b>상대 트랜잭션이 끝날 때까지 기다렸다가</b> 0 을 돌려주므로,
     * 호출부가 곧바로 잠금 조회로 넘어가면 두 명령이 정상적으로 직렬화된다.
     *
     * @param aggregateType 순서 축의 종류
     * @param aggregateId   순서 축의 식별자
     * @param now           생성 시각
     * @return 1 = 이 호출이 만들었다, 0 = 이미 있다
     */
    @Modifying
    @Query(value = "INSERT INTO aggregate_versions (aggregate_type, aggregate_id, last_version, updated_at) "
            + "VALUES (:aggregateType, :aggregateId, 0, :now) "
            + "ON CONFLICT (aggregate_type, aggregate_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(
            @Param("aggregateType") String aggregateType,
            @Param("aggregateId") String aggregateId,
            @Param("now") Instant now);
}

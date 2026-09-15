package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * 순서용 version 을 <b>aggregate 행 잠금 아래</b> 발급한다 (㊸ · A21).
 *
 * <h2>왜 시퀀스가 아닌가</h2>
 * 시퀀스는 <b>번호 할당 순서만</b> 보장하고 커밋 순서를 보장하지 않는다. 같은 유저의 T1 이 10 을 받고
 * 멈춘 사이 T2 가 11 을 커밋·발행한 뒤 T1 이 마지막에 커밋하면, DB 의 최종 상태는 T1 인데 소비자는
 * 최대값 11 때문에 <b>이벤트 10 을 폐기</b>한다. relay 도 T2 커밋 시점엔 아직 보이지 않는 T1 행을
 * 「선행 미전달」로 감지할 수 없다.
 *
 * <p>그래서 행을 잠근 채 번호를 올린다. 잠금은 <b>호출한 트랜잭션이 끝날 때까지</b> 유지되므로 같은
 * 축의 두 트랜잭션이 겹치지 않고, 번호 순서가 곧 커밋 순서가 된다.
 *
 * <h2>첫 발급의 경합</h2>
 * 행이 없을 때 두 명령이 동시에 오면 {@code save()} 는 한쪽을 UNIQUE 위반으로 죽이고 그 예외가
 * 트랜잭션을 오염시킨다. 그래서 {@code ON CONFLICT DO NOTHING} 으로 만들고 다시 잠금 조회한다 —
 * 그 INSERT 는 상대의 미커밋 행을 만나면 <b>기다렸다가</b> 0 을 돌려주므로 곧이은 잠금 조회가 반드시
 * 행을 본다.
 *
 * <h2>여러 USER 를 한 트랜잭션에서 잠글 때 (GROMO-893)</h2>
 * 잠금이 커밋까지 유지되므로 fan-out 이 수신자를 루프 순서대로 하나씩 잠그면, 순서가 다른 두
 * 트랜잭션이 A→B · B→A 로 교착한다. {@link #lockUsers} 는 수신자 집합을 받아
 * {@link UserAggregateLockOrderGuard} 의 정본 순서로 <b>한 번에</b> 잡는다. 단건 {@link #allocate} 도 같은
 * 장부에 적히므로, 이미 잡은 행에 대한 이후 발급은 대기 없이 지나가고 정본 순서를 거스르는 새 획득은
 * 감시에 걸린다.
 */
@Service
@RequiredArgsConstructor
public class AggregateVersionAllocator {

    /**
     * 한 문장에 싣는 id 수 상한 — 바인드 파라미터 한도 아래로 자른다.
     *
     * <p>잘라도 정본 순서는 유지된다: 뒤 조각의 id 는 전부 앞 조각보다 크므로 전체 획득 순서가
     * 여전히 오름차순이다.
     */
    static final int LOCK_BATCH_SIZE = 500;

    private final AggregateVersionRepository aggregateVersionRepository;
    private final UserAggregateLockOrderGuard lockOrderGuard;
    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    /**
     * 다음 번호를 발급한다.
     *
     * <p>{@code MANDATORY} 다 — 트랜잭션 밖에서 부르면 잠금이 즉시 풀려 「직렬화한다」는 계약이
     * 조용히 사라진다. 그런 호출은 예외로 죽는 편이 낫다.
     *
     * @param aggregate 순서 축
     * @return 새로 발급된 단조 증가 값(1부터)
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public long allocate(AggregateRef aggregate) {
        boolean user = AggregateRef.TYPE_USER.equals(aggregate.type());
        if (user) {
            lockOrderGuard.checkBeforeAcquire(lockOrderGuard.notYetHeld(List.of(aggregate.id())));
        }
        Instant now = clock.instant();
        AggregateVersion row = aggregateVersionRepository
                .findForUpdate(aggregate.type(), aggregate.id())
                .orElseGet(() -> createThenLock(aggregate, now));
        if (user) {
            lockOrderGuard.recordHeld(List.of(aggregate.id()));
        }
        return row.allocateNext(now);
    }

    /**
     * 여러 USER aggregate 행을 <b>정본 순서로 한 번에</b> 잠근다 — 번호는 발급하지 않는다.
     *
     * <p>fan-out 은 적기 전에 이것으로 수신자 전원을 선점한다. 이후 수신자마다 부르는 {@link #allocate}
     * 는 이미 쥔 행이라 기다리지 않는다.
     *
     * <h2>두 문장인 이유</h2>
     * 없는 행은 {@code SELECT … FOR UPDATE} 로 잠글 수 없다(보이지 않는 행은 반환되지도 기다리지도 않는다).
     * 그래서 먼저 없는 행을 같은 순서로 {@code INSERT … ON CONFLICT DO NOTHING} 하고 — 상대의 미커밋
     * 삽입과 부딪히면 그 트랜잭션이 끝날 때까지 기다린다 — 이어서 전부를 같은 순서로 잠근다.
     * {@code ORDER BY … COLLATE "C"} 는 정렬 노드를 잠금 노드 아래에 두므로 행이 정렬된 순서로 잠긴다.
     *
     * @param userIds 잠글 사용자 — 중복·순서 무관
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lockUsers(Collection<UUID> userIds) {
        List<String> ids = lockOrderGuard.notYetHeld(UserAggregateLockOrderGuard.canonicalOrder(userIds));
        if (ids.isEmpty()) {
            return;
        }
        lockOrderGuard.checkBeforeAcquire(ids);
        Timestamp now = Timestamp.from(clock.instant());
        for (int from = 0; from < ids.size(); from += LOCK_BATCH_SIZE) {
            List<String> batch = ids.subList(from, Math.min(from + LOCK_BATCH_SIZE, ids.size()));
            List<Object> insertArgs = new ArrayList<>(batch.size() + 1);
            insertArgs.add(now);
            insertArgs.addAll(batch);
            jdbcTemplate.update("INSERT INTO aggregate_versions"
                    + " (aggregate_type, aggregate_id, last_version, updated_at)"
                    + " SELECT '" + AggregateRef.TYPE_USER + "', v.id, 0, ?"
                    + " FROM (VALUES " + String.join(",", Collections.nCopies(batch.size(), "(?)")) + ") AS v(id)"
                    + " ORDER BY v.id COLLATE \"C\""
                    + " ON CONFLICT (aggregate_type, aggregate_id) DO NOTHING", insertArgs.toArray());
            List<String> locked = jdbcTemplate.queryForList("SELECT aggregate_id FROM aggregate_versions"
                    + " WHERE aggregate_type = '" + AggregateRef.TYPE_USER + "'"
                    + " AND aggregate_id IN (" + String.join(",", Collections.nCopies(batch.size(), "?")) + ")"
                    + " ORDER BY aggregate_id COLLATE \"C\" FOR UPDATE", String.class, batch.toArray());
            if (locked.size() != batch.size()) {
                throw new IllegalStateException("USER aggregate 행을 만든 직후에 전부 잠그지 못했습니다 — 기대 "
                        + batch.size() + "건, 잠금 " + locked.size() + "건");
            }
            lockOrderGuard.recordHeld(batch);
        }
    }

    /**
     * 첫 행을 만들고 <b>다시 잠가서</b> 읽는다.
     *
     * <p>방금 만든 행을 잠그지 않고 쓰면 안 된다 — 같은 축의 첫 명령 둘 중 늦은 쪽은 INSERT 가 0 을
     * 돌려받고 상대가 만든 행을 보게 되는데, 그 행을 잠그지 않으면 둘이 같은 {@code lastVersion} 을
     * 읽어 같은 번호를 발급한다.
     */
    private AggregateVersion createThenLock(AggregateRef aggregate, Instant now) {
        aggregateVersionRepository.insertIfAbsent(aggregate.type(), aggregate.id(), now);
        return aggregateVersionRepository
                .findForUpdate(aggregate.type(), aggregate.id())
                .orElseThrow(() -> new IllegalStateException(
                        "aggregate version 행을 만든 직후에 찾지 못했습니다 — type=" + aggregate.type()));
    }
}

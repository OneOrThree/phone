package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

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
 */
@Service
@RequiredArgsConstructor
public class AggregateVersionAllocator {

    private final AggregateVersionRepository aggregateVersionRepository;
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
        Instant now = clock.instant();
        AggregateVersion row = aggregateVersionRepository
                .findForUpdate(aggregate.type(), aggregate.id())
                .orElseGet(() -> createThenLock(aggregate, now));
        return row.allocateNext(now);
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

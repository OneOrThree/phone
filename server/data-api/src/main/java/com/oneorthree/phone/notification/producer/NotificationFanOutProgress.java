package com.oneorthree.phone.notification.producer;

import org.springframework.stereotype.Component;

/**
 * 배치 한 번이 <b>이미 커밋한 조각 수</b> — 재판정해도 되는지 가르는 근거다 (GROMO-893).
 *
 * <h2>왜 필요한가</h2>
 * 배치는 판정 스냅샷 하나로 후보를 고르고, 적기만 짧은 조각 트랜잭션으로 나눈다. 조각 하나라도 커밋된 뒤 배치 전체를
 * 새 스냅샷으로 다시 판정하면, 그 사이 상태가 바뀐 사용자는 <b>다른 종류</b>의 알림을 받는다 — 결정적 키는 종류를
 * 축으로 가지므로 접히지 않고, 같은 슬롯에 강등 경고와 마감 D-1 이 둘 다 나간다. 조각 트랜잭션이 없던 때에는 앞
 * 페이지까지 함께 롤백됐으므로 일어날 수 없던 일이다.
 *
 * <p>그래서 커밋 여부를 «이 {@code write} 호출» 이 아니라 <b>배치 실행 전체</b>로 센다. 리그처럼 페이지마다
 * {@code write} 를 따로 부르는 배치는 앞 페이지가 이미 커밋돼 있어도 뒤 페이지의 첫 조각은 «아무것도 커밋 안 됨»으로
 * 보이기 때문이다.
 *
 * <p>범위는 배치를 도는 스레드에 묶는다. 판정과 조각 쓰기가 같은 스레드에서 차례로 돌고, 재시도 정책
 * ({@code NotificationBatchRetry})이 그 스레드에서 범위를 열고 닫는다. 범위 밖(수동 트리거)에서는 세지 않는다.
 */
@Component
public class NotificationFanOutProgress {

    private final ThreadLocal<Counter> current = new ThreadLocal<>();

    /**
     * 배치 실행 범위를 연다. 이미 열려 있으면 그 범위를 함께 쓴다 — 안쪽이 닫으면서 바깥의 커밋 기록을 지우지 않게.
     *
     * @return 닫아야 하는 범위
     */
    public Scope open() {
        Counter existing = current.get();
        if (existing != null) {
            return new Scope(existing, false);
        }
        Counter counter = new Counter();
        current.set(counter);
        return new Scope(counter, true);
    }

    /** 조각 하나가 커밋됐다 — 열린 범위가 없으면 아무 일도 하지 않는다. */
    void recordCommittedChunk() {
        Counter counter = current.get();
        if (counter != null) {
            counter.committed++;
        }
    }

    /** @return 열린 범위에서 커밋된 조각 수. 범위가 없으면 {@code -1} */
    int committedChunks() {
        Counter counter = current.get();
        return counter == null ? -1 : counter.committed;
    }

    /** 배치 실행 한 번의 범위. */
    public final class Scope implements AutoCloseable {

        private final Counter counter;
        private final boolean owner;

        private Scope(Counter counter, boolean owner) {
            this.counter = counter;
            this.owner = owner;
        }

        /** @return 이 범위에서 커밋된 조각 수 */
        public int committedChunks() {
            return counter.committed;
        }

        @Override
        public void close() {
            if (owner) {
                current.remove();
            }
        }
    }

    private static final class Counter {
        private int committed;
    }
}

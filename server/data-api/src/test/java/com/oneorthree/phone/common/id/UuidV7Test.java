package com.oneorthree.phone.common.id;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * PK 발급의 <b>단조성</b> — 이제 계약이다.
 *
 * <p>집중 프레즌스 리스가 {@code focus_sessions.id} 의 시간 순서로 「어느 시작·종료가 더 새로운가」를
 * 판정한다(GROMO-292). 그래서 「같은 밀리초 안에서도 나중에 뽑은 id 가 더 크다」가 깨지면 정상적인
 * 새 시작이 「이미 끝난 세션」으로 무시되거나, 옛 리스가 남아 최대 13시간 채팅이 막힌다.
 *
 * <p><b>이 테스트가 없으면 그 회귀는 조용하다.</b> 생성기를 호출마다 새로 만들어도 UUID 는 잘 나오고
 * 다른 테스트도 전부 통과한다 — 어긋남은 같은 밀리초에 두 건이 몰릴 때만, 그것도 절반의 확률로만
 * 드러난다(실측: 20,000건 중 9,993건 역전).
 */
class UuidV7Test {

    /** 같은 밀리초에 확실히 몰리도록 충분히 많이, 연속으로 뽑는다. */
    private static final int SAMPLE = 20_000;

    @Test
    @DisplayName("연속 발급은 «부호 없는 바이트 비교»에서 단조 증가한다 — Postgres 의 uuid 정렬과 같은 기준")
    void isMonotonic() {
        UUID previous = UuidV7.next();
        int inversions = 0;

        for (int i = 0; i < SAMPLE; i++) {
            UUID current = UuidV7.next();
            if (compareUnsigned(previous, current) >= 0) {
                inversions++;
            }
            previous = current;
        }

        assertThat(inversions).isZero();
    }

    @Test
    @DisplayName("여러 스레드가 동시에 뽑아도 겹치지 않는다 — static 하나를 공유해도 안전한가")
    void isThreadSafe() throws InterruptedException {
        int threads = 8;
        int perThread = 5_000;
        List<UUID> all = new CopyOnWriteArrayList<>();
        CountDownLatch done = new CountDownLatch(threads);
        ExecutorService pool = Executors.newFixedThreadPool(threads);

        for (int t = 0; t < threads; t++) {
            pool.submit(() -> {
                try {
                    for (int i = 0; i < perThread; i++) {
                        all.add(UuidV7.next());
                    }
                } finally {
                    done.countDown();
                }
            });
        }

        assertThat(done.await(30, TimeUnit.SECONDS)).isTrue();
        pool.shutdown();

        Set<UUID> unique = new HashSet<>(all);
        assertThat(all).hasSize(threads * perThread);
        assertThat(unique).hasSameSizeAs(all);
    }

    @Test
    @DisplayName("v7 이다 — 버전 비트가 7, variant 가 RFC 4122")
    void isVersionSeven() {
        UUID id = UuidV7.next();

        assertThat(id.version()).isEqualTo(7);
        assertThat(id.variant()).isEqualTo(2);
    }

    /**
     * Postgres 의 {@code uuid} 비교와 같은 기준(부호 없는 바이트열).
     *
     * <p>자바 {@code UUID.compareTo} 는 부호 있는 long 두 개라 최상위 비트에서 갈린다 — 지금 시대의
     * v7 은 그 비트가 0 이라 결과가 같지만, 기준을 명시해 두는 편이 낫다.
     */
    private static int compareUnsigned(UUID a, UUID b) {
        int high = Long.compareUnsigned(a.getMostSignificantBits(), b.getMostSignificantBits());
        return high != 0 ? high : Long.compareUnsigned(a.getLeastSignificantBits(), b.getLeastSignificantBits());
    }
}

package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyReason;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * [직접 구현 B - ④ 동시성] InGameCurrency 통합 테스트 골격.
 *
 * <p>단위 테스트(Mockito)로는 재현 불가능 — 실제 DB + 멀티스레드로 User.@Version(낙관적 락)이
 * 이중 차감을 막는지 검증한다. {@code InGameCurrencyServiceTest}(단위)와 다른 종류의 테스트다.
 *
 * <p><b>설계 시 주의사항</b>
 * <ul>
 *   <li><b>@Transactional 금지</b>: {@code RepositoryTestBase}는 @Transactional 이라 테스트가 단일
 *       트랜잭션으로 묶이고 롤백된다 → 스레드 간 변경이 안 보여 동시성 재현 불가.
 *       이 클래스는 @SpringBootTest 만 쓰고 @Transactional 을 붙이지 않는다(컨테이너 설정은 직접/공유).</li>
 *   <li>각 스레드가 <b>독립 트랜잭션</b>을 열어야 한다(서비스 @Transactional 이 스레드별로 적용되도록 별도 호출).</li>
 *   <li>테스트가 직접 만든 데이터는 롤백되지 않으므로 <b>@AfterEach 정리</b> 필요.</li>
 * </ul>
 *
 * <p>TODO: 컨테이너 설정 + 본문 구현 후 @Disabled 제거.
 */
class InGameCurrencyConcurrencyTest extends IntegrationTestBase {

     @Autowired
     UserRepository userRepo;
     @Autowired
     InGameCurrencyService inGameCurrencyService;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private User user;
    // Testcontainers Postgres 설정: RepositoryTestBase 의 컨테이너/@DynamicPropertySource 를
    // 그대로 가져오되 @Transactional 만 제거한 별도 베이스를 두거나, 여기서 직접 선언.

    @BeforeEach
    void setUp() {
        user = userRepo.save(
                User.builder()
                        .currency(100)
                        .isGuest(false)
                        .build()
        );
    }

    @Test
    @DisplayName("동시에 spendCurrency 2회(각 80, 잔액 100) → 1건만 성공, 이중 차감 없음")
    void concurrentSpendDoesNotDoubleSpend() throws Exception {
        // given: 잔액 100 인 user 를 실제로 저장 (userRepository.save)
        //  @BeforEach로 대체

        // when: 두 스레드가 동시에 spendCurrency(userId, PURCHASE, 80)
        int threadCount = 2;
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch doneGate = new CountDownLatch(threadCount);

        AtomicInteger successCount = new AtomicInteger();
        List<Throwable> failures = Collections.synchronizedList(new ArrayList<Throwable>());

        for (int i = 0; i < threadCount; i++) {
            pool.submit(() -> {
                try {
                    startGate.await();
                    inGameCurrencyService.spendCurrency(user.getId(), CurrencyReason.PURCHASE, 80);
                    successCount.incrementAndGet();
                }
                catch (Throwable e) {
                    failures.add(e);
                }
                finally {
                    doneGate.countDown();
                }
            });
        }

        startGate.countDown(); // 쓰레드 시작
        boolean finished = doneGate.await(5, TimeUnit.SECONDS);   // 끝날 때 가지 대기
        assertThat(finished).isTrue();
        pool.shutdown();

        // then: 예외 "타입" 단정은 타이밍상 flaky(낙관적 락 충돌 vs 잔액부족) → 결과 "상태"로 검증
        assertThat(successCount.get()).isEqualTo(1);   // 정확히 1건만 성공
        assertThat(failures).hasSize(1);               // 1건은 막힘(동시 차감 차단)

        User reloaded = userRepo.findById(user.getId()).orElseThrow();
        assertThat(reloaded.getCurrency()).isEqualTo(20);   // 이중 차감/음수 없음 (100-80, 두 번째는 미반영)
    }
}

package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * [GROMO-560 동시성] ScreenTime 저장 멱등성 통합 테스트.
 *
 * <p>단위 테스트(Mockito)로는 재현 불가 — 실제 DB + 멀티스레드로 같은 (user, date) 동시 저장이
 * UNIQUE(user_id, date) 레이스를 일으킬 때, 진 요청도 새 트랜잭션 재조회로 흡수돼 "둘 다 정상"이 되는지
 * 검증한다. 접근 B(DataIntegrityViolationException catch → 새 트랜잭션 재조회·업데이트) 검증.
 *
 * <p><b>설계 시 주의사항</b>
 * <ul>
 *   <li><b>@Transactional 금지</b>: 클래스에 붙이면 테스트가 단일 트랜잭션으로 묶여 롤백된다 →
 *       스레드 간 변경이 안 보여 동시성 재현 불가. IntegrationTestBase(@SpringBootTest)만 상속한다.</li>
 *   <li>각 스레드가 <b>독립 트랜잭션</b>을 열도록 서비스 메서드를 스레드별로 호출한다.</li>
 *   <li>테스트가 만든 데이터는 롤백되지 않으므로 <b>@AfterEach 정리</b>가 필요하다.</li>
 * </ul>
 */
class ScreenTimeConcurrencyTest extends IntegrationTestBase {

    @Autowired
    UserRepository userRepository;
    @Autowired
    DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    @Autowired
    ScreenTimeService screenTimeService;

    // 모든 스레드가 같은 (user, date) 로 향하도록 고정한 과거 시각. 과거 날짜라 finalReport 로 추론되나
    // clientAchieved=false 라 목표 달성 알림·이벤트 side-effect 는 발사되지 않아 순수 멱등 upsert 만 검증한다.
    private static final Instant REPORTED_AT = Instant.parse("2020-01-01T00:00:00Z");
    // 저장 날짜 축은 KST 고정(GROMO-1259, ZonePolicy) — REPORTED_AT 의 KST 로컬 날짜.
    private static final LocalDate DATE =
            REPORTED_AT.atZone(ZonePolicy.KST).toLocalDate();
    // 스크린타임은 덮어쓰기(last-write-wins)라 모든 스레드가 같은 값을 쓰면 최종값이 결정론적이다.
    private static final int SCREEN_TIME_MINUTES = 60;

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().isGuest(false).build());
    }

    @AfterEach
    void tearDown() {
        // 공유 Testcontainers DB — 전역 deleteAll 은 다른 테스트 데이터의 FK 를 건드리므로 내 데이터만 정리한다.
        dailyScreenTimeStatRepository.findByUserAndDate(user, DATE)
                .ifPresent(dailyScreenTimeStatRepository::delete);
        userRepository.delete(user);
    }

    @Test
    @DisplayName("동시에 saveScreenTime 2회(같은 user·date) → row 정확히 1개, 예외 0건, total 일관")
    void concurrentSaveScreenTimeTwoRequestsUpsertsSingleRow() throws Exception {
        assertConcurrentSaveUpsertsSingleRow(2);
    }

    @Test
    @DisplayName("동시에 saveScreenTime 10회(같은 user·date) → row 정확히 1개, 예외 0건, total 일관")
    void concurrentSaveScreenTimeTenRequestsUpsertsSingleRow() throws Exception {
        assertConcurrentSaveUpsertsSingleRow(10);
    }

    private void assertConcurrentSaveUpsertsSingleRow(int threadCount) throws Exception {
        // 한계(codex P3): startGate 는 스레드를 동시 출발시킬 뿐, 각 스레드가 findByUserAndDate empty 를 관찰한
        // 시점에 붙잡아 insert 레이스를 '결정론적으로' 강제하진 않는다. 빠른 워커가 먼저 커밋하면 나머지는 update
        // path 만 타 재시도 경로가 미검증될 수 있다. 다만 N=10 + 동시 출발로 실용적으로 재현되며(구현 전 RED 에서
        // 실제 DIVE 발생 확인), 결정론적 barrier 는 프로덕션에 테스트 seam 을 요구해 이 티켓 스코프에서 제외한다.
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch doneGate = new CountDownLatch(threadCount);
        List<Throwable> failures = Collections.synchronizedList(new ArrayList<Throwable>());

        for (int i = 0; i < threadCount; i++) {
            pool.submit(() -> {
                try {
                    startGate.await();
                    screenTimeService.saveScreenTime(
                            user.getId(),
                            new ScreenTimeRequest(false, SCREEN_TIME_MINUTES, REPORTED_AT, true));
                }
                catch (Throwable e) {
                    failures.add(e);
                }
                finally {
                    doneGate.countDown();
                }
            });
        }

        startGate.countDown(); // 모든 스레드 동시 시작
        boolean finished = doneGate.await(10, TimeUnit.SECONDS); // 완료 대기
        assertThat(finished).isTrue();
        pool.shutdown();

        // 레이스에서 진 요청도 새 트랜잭션 재조회로 흡수 → 예외 0건, (user, date) row 정확히 1개, total 일관.
        // UNIQUE(user_id, date) 제약이 있어 findByUserAndDate 가 present 면 그 (user, date) row 는 정확히 1개다.
        assertThat(failures).isEmpty();
        Optional<DailyScreenTimeStat> stat = dailyScreenTimeStatRepository.findByUserAndDate(user, DATE);
        assertThat(stat).isPresent();
        assertThat(stat.get().getTotalScreenTimeMinutes()).isEqualTo(SCREEN_TIME_MINUTES);
    }
}

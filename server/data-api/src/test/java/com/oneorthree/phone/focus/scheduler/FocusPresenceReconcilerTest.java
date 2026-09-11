package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.UnexpectedRollbackException;
import org.springframework.transaction.support.TransactionOperations;

import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willReturn;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 기동 시 DB 정본에서 프레즌스를 재구축하는지, 그리고 그 재구축이 <b>기동을 붙잡지 않는지</b>.
 *
 * <p>재구축이 없으면 {@code focus.presence.enabled} 를 «처음 켜는» 순간 이미 진행 중이던 집중은
 * 리스가 없어, 그 사람들은 세션이 끝날 때까지 집중 중에도 채팅에 들어가고 발신할 수 있다 — 롤아웃 창
 * 전체가 규칙 밖이 된다. Redis 가 비었을 때도 같다. 목표 아키텍처 A19 의 「Redis 는 사본이라 소유자가
 * DB 정본에서 재구축할 수 있어야 한다」가 프레즌스 쪽에서 구현된 자리이기도 하다.
 *
 * <p><b>여기서 실행기를 가짜로 주입하는 이유.</b> 진짜 실행기를 쓰면 단언이 워커 스레드와 경주하게 돼
 * 테스트가 간헐적으로 통과한다. 대신 「제자리에서 실행」과 「받아만 두고 실행하지 않음」 두 벌을 써서,
 * 재구축 «내용»과 「기동 스레드에서 돌지 않는다」는 «성질»을 따로 못 박는다.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FocusPresenceReconcilerTest {

    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");

    /** 제자리에서 실행 — 재구축의 «내용»을 결정적으로 단언하기 위해. */
    private static final AsyncTaskExecutor INLINE = Runnable::run;

    /** 넘긴 일을 «돌리지 않는다» — 주기 진입점이 기동 실행기를 타지 않는다는 것도 같이 못 박는다. */
    private static final AsyncTaskExecutor NEVER_RUNS = task -> { };

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @Mock
    private FocusPresencePort focusPresencePort;

    /** 트랜잭션 경계를 흉내만 낸다 — 이 클래스가 검증하려는 것은 경계의 «위치»지 트랜잭션 자체가 아니다. */
    private final TransactionOperations transactions = TransactionOperations.withoutTransaction();

    @BeforeEach
    void releaseSucceedsByDefault() {
        // 대부분의 테스트는 「지워졌다」를 전제한다. 「못 지웠다」는 아래 전용 테스트가 본다.
        given(focusPresencePort.releaseLeaseNow(any(), any())).willReturn(true);
        given(focusPresencePort.restoreLeaseIfMissing(any(), any(), any())).willReturn(true);
    }

    private FocusPresenceReconciler reconciler(AsyncTaskExecutor executor) {
        return new FocusPresenceReconciler(focusSessionRepository, focusPresencePort, transactions,
                executor, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("진행 중인 세션 전부에 리스를 다시 놓는다 — 각자 «자기» 세션 id 로")
    void restoresLeasesForOpenMarkers() {
        UUID firstUser = UUID.randomUUID();
        UUID secondUser = UUID.randomUUID();
        FocusSession first = openMarker(firstUser);
        FocusSession second = openMarker(secondUser);
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of(first, second));

        reconciler(INLINE).onApplicationReady();

        verify(focusPresencePort).restoreLeaseIfMissing(firstUser, first.getId(), first.getStartedAt());
        verify(focusPresencePort).restoreLeaseIfMissing(secondUser, second.getId(), second.getStartedAt());
    }

    @Test
    @DisplayName("한 유저에게 열린 마커가 여럿이면 «최신 것만» 복원한다 — 오래된 것이 키를 차지하면 안 된다")
    void restoresOnlyTheNewestMarkerPerUser() {
        UUID userId = UUID.randomUUID();
        FocusSession older = markerStartedAt(userId, NOW.minusSeconds(3600));
        FocusSession newer = markerStartedAt(userId, NOW.minusSeconds(60));
        // 조회에는 정렬이 없다 — 오래된 것이 먼저 올 수 있다.
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any()))
                .willReturn(List.of(older, newer));

        reconciler(INLINE).onApplicationReady();

        // 오래된 마커가 리스를 차지하면, 그 마커가 끝날 때 리스가 지워지는데 최신 마커는 아직 살아 있다
        // — 그 사람은 집중 중인데 다음 회차까지 채팅이 열린다.
        verify(focusPresencePort).restoreLeaseIfMissing(userId, newer.getId(), newer.getStartedAt());
        verify(focusPresencePort, never()).restoreLeaseIfMissing(any(), eq(older.getId()), any());
    }

    @Test
    @DisplayName("이미 고아 판정 시각을 넘긴 세션은 모수에서 빠진다 — 되살리면 TTL 이 지금부터 다시 13시간이다")
    void queriesOnlyWithinTheOrphanWindow() {
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of());

        reconciler(INLINE).onApplicationReady();

        ArgumentCaptor<Instant> threshold = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).findByEndedAtIsNullAndStartedAtAfter(threshold.capture());
        // 스윕과 «같은» 기준이어야 한다. 여기만 넓히면 스윕이 곧 끝낼 세션의 리스를 되살리게 된다.
        assertThat(threshold.getValue()).isEqualTo(NOW.minus(FocusService.ORPHAN_TIMEOUT));
    }

    @Test
    @DisplayName("유저가 없는(탈퇴로 끊긴) 행은 건너뛴다 — 누구의 리스인지 알 수 없다")
    void skipsRowsWithoutUser() {
        FocusSession orphaned = FocusSession.builder()
                .id(UUID.randomUUID())
                .startedAt(NOW.minusSeconds(60))
                .build();
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of(orphaned));

        reconciler(INLINE).onApplicationReady();

        verify(focusPresencePort, never()).restoreLeaseIfMissing(any(), any(), any());
    }

    @Test
    @DisplayName("진행 중인 세션이 없으면 아무것도 하지 않는다")
    void doesNothingWhenNoOpenMarkers() {
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of());

        reconciler(INLINE).onApplicationReady();

        verify(focusPresencePort, never()).restoreLeaseIfMissing(any(), any(), any());
    }

    @Test
    @DisplayName("조회가 터져도 «기동»을 막지 않는다 — Redis·DB 때문에 코어 API 가 못 뜨면 안 된다")
    void failureDoesNotBlockStartup() {
        willThrow(new IllegalStateException("db down"))
                .given(focusSessionRepository).findByEndedAtIsNullAndStartedAtAfter(any());

        assertThatCode(() -> reconciler(INLINE).onApplicationReady()).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("트랜잭션이 «반환 후» 던지는 UnexpectedRollbackException 도 삼킨다 — 경계가 메서드 안이라서")
    void rollbackExceptionFromTheTransactionBoundaryIsSwallowed() {
        TransactionOperations rollingBack = new TransactionOperations() {
            @Override
            public <T> T execute(org.springframework.transaction.support.TransactionCallback<T> action) {
                throw new UnexpectedRollbackException("커밋이 롤백으로 끝났다");
            }
        };
        FocusPresenceReconciler reconciler = new FocusPresenceReconciler(focusSessionRepository, focusPresencePort,
                rollingBack, INLINE, Clock.fixed(NOW, ZoneOffset.UTC));

        assertThatCode(reconciler::onApplicationReady).doesNotThrowAnyException();
        verifyNoInteractions(focusPresencePort);
    }

    @Test
    @DisplayName("기동 스레드에서는 «한 줄도» 돌지 않는다 — Redis 가 죽으면 유저 수만큼 타임아웃을 기다리게 된다")
    void reconciliationNeverRunsOnTheStartupThread() {
        AtomicInteger submitted = new AtomicInteger();
        List<Runnable> deferred = new ArrayList<>();
        AsyncTaskExecutor capturing = task -> {
            submitted.incrementAndGet();
            deferred.add(task);
        };

        reconciler(capturing).onApplicationReady();

        // 리스너가 반환된 시점에 조회조차 시작되지 않았다.
        assertThat(submitted.get()).isEqualTo(1);
        verifyNoInteractions(focusSessionRepository, focusPresencePort);

        // 그리고 넘긴 일은 진짜 재구축이다 — 「그냥 아무것도 안 한다」와 구별한다.
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of());
        deferred.get(0).run();
        verify(focusSessionRepository).findByEndedAtIsNullAndStartedAtAfter(any());
    }

    @Test
    @DisplayName("놓아 준 뒤 «그 사이 끝난» 세션의 리스는 회수한다 — 안 하면 아무도 안 치운다")
    void releasesLeasesForSessionsThatEndedDuringTheRebuild() {
        UUID stillFocusing = UUID.randomUUID();
        UUID justEnded = UUID.randomUUID();
        FocusSession open = openMarker(stillFocusing);
        FocusSession ended = openMarker(justEnded);
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any()))
                .willReturn(List.of(open, ended));
        // 읽고 쓰는 사이에 끝났다 — 그 종료의 Redis 쓰기가 실패했다면 «끝났다» 표식조차 없다.
        // ⚠️ given(mock.call(...)) 형태로 «다시» 스텁하면 그 순간 실제 호출이 일어나 앞의 willThrow 가
        //    터진다. 이미 예외를 스텁해 둔 메서드는 반드시 willReturn(...).given(mock) 순서로 바꾼다.
        willReturn(List.of(ended)).given(focusSessionRepository).findByIdInAndEndedAtIsNotNull(any());

        reconciler(INLINE).onApplicationReady();

        verify(focusPresencePort).restoreLeaseIfMissing(stillFocusing, open.getId(), open.getStartedAt());
        verify(focusPresencePort).restoreLeaseIfMissing(justEnded, ended.getId(), ended.getStartedAt());
        // 끝난 쪽만 회수한다 — 진행 중인 쪽을 함께 풀면 규칙이 통째로 사라진다.
        verify(focusPresencePort).releaseLeaseNow(justEnded, ended.getId());
        verify(focusPresencePort, never()).releaseLeaseNow(eq(stillFocusing), any());
    }

    @Test
    @DisplayName("되묻기는 «놓아 준 것이 있을 때만» 한다 — 빈 회차가 매번 쿼리를 하나 더 치면 안 된다")
    void doesNotRequeryWhenNothingWasRestored() {
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of());

        reconciler(INLINE).onApplicationReady();

        verify(focusSessionRepository, never()).findByIdInAndEndedAtIsNotNull(any());
    }

    @Test
    @DisplayName("저장소가 흔들리면 «첫 실패에서» 멈춘다 — 남은 건마다 타임아웃을 기다리면 안 된다")
    void stopsAtTheFirstStorageFailure() {
        List<FocusSession> many = List.of(openMarker(UUID.randomUUID()), openMarker(UUID.randomUUID()),
                openMarker(UUID.randomUUID()));
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(many);
        willReturn(false).given(focusPresencePort).restoreLeaseIfMissing(any(), any(), any());

        reconciler(INLINE).onApplicationReady();

        // Redis 가 드롭된 상태에서 셋을 다 시도하면 스케줄러 슬롯을 세 배로 점유한다.
        // 다음 회차가 같은 목록을 다시 읽으므로 여기서 멈춰도 잃는 것이 없다.
        verify(focusPresencePort, times(1)).restoreLeaseIfMissing(any(), any(), any());
    }

    @Test
    @DisplayName("해제도 첫 실패에서 멈추고, 못 한 것은 «전부» 다음 회차로 넘긴다")
    void stopsReleasingAtTheFirstFailureAndPostponesTheRest() {
        UUID firstUser = UUID.randomUUID();
        FocusSession first = openMarker(firstUser);
        FocusSession second = openMarker(UUID.randomUUID());
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any()))
                .willReturn(List.of(first, second));
        given(focusSessionRepository.findByIdInAndEndedAtIsNotNull(any()))
                .willReturn(List.of(first, second));
        willReturn(false).given(focusPresencePort).releaseLeaseNow(firstUser, first.getId());

        FocusPresenceReconciler reconciler = reconciler(INLINE);
        reconciler.reconcilePeriodically();

        // 첫 건이 실패하면 둘째는 «시도조차» 하지 않는다.
        verify(focusPresencePort, times(1)).releaseLeaseNow(any(), any());

        // 그리고 둘 다 다음 회차 후보로 남는다 — 둘째는 아직 손도 안 댔으니까.
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of());
        ArgumentCaptor<Collection<UUID>> asked = ArgumentCaptor.forClass(Collection.class);
        reconciler.reconcilePeriodically();
        verify(focusSessionRepository, times(2)).findByIdInAndEndedAtIsNotNull(asked.capture());
        assertThat(asked.getAllValues().get(1)).contains(first.getId(), second.getId());
    }

    @Test
    @DisplayName("해제가 «실패»하면 다음 회차에 다시 든다 — 조회 성공과 해제 성공은 다른 연산이다")
    void aFailedReleaseIsRetriedOnTheNextCycle() {
        UUID userId = UUID.randomUUID();
        FocusSession open = openMarker(userId);
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of(open));
        given(focusSessionRepository.findByIdInAndEndedAtIsNotNull(any())).willReturn(List.of(open));
        // 조회는 성공했는데 리스 삭제만 타임아웃 — Redis 가 간헐적으로 흔들릴 때의 모습이다.
        given(focusPresencePort.releaseLeaseNow(userId, open.getId())).willReturn(false);

        FocusPresenceReconciler reconciler = reconciler(INLINE);
        reconciler.reconcilePeriodically();

        // 다음 회차: 그 세션은 진행 중 조회에 안 잡힌다. 대기 목록이 잡아 주지 않으면 영영 끝이다.
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of());
        willReturn(true).given(focusPresencePort).releaseLeaseNow(userId, open.getId());

        reconciler.reconcilePeriodically();

        verify(focusPresencePort, times(2)).releaseLeaseNow(userId, open.getId());
    }

    @Test
    @DisplayName("되묻기가 터진 세션은 «다음 회차»에 다시 든다 — 안 그러면 두 번 다시 후보가 안 된다")
    void aFailedRecheckIsRetriedOnTheNextCycle() {
        UUID userId = UUID.randomUUID();
        FocusSession open = openMarker(userId);
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of(open));
        // 1회차: 되묻기 조회가 터진다.
        willThrow(new IllegalStateException("db down"))
                .given(focusSessionRepository).findByIdInAndEndedAtIsNotNull(any());

        FocusPresenceReconciler reconciler = reconciler(INLINE);
        reconciler.reconcilePeriodically();

        // 2회차: 그 세션은 이미 끝나서 «진행 중» 조회에는 잡히지 않는다. 대기 목록이 없으면 여기서
        // 영영 사라지고, 잘못 놓인 리스는 TTL(시작 기준 13시간)까지 채팅을 막는다.
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of());
        FocusSession ended = openMarker(userId);
        ReflectionTestUtils.setField(ended, "id", open.getId());
        // ⚠️ given(mock.call(...)) 형태로 «다시» 스텁하면 그 순간 실제 호출이 일어나 앞의 willThrow 가
        //    터진다. 이미 예외를 스텁해 둔 메서드는 반드시 willReturn(...).given(mock) 순서로 바꾼다.
        willReturn(List.of(ended)).given(focusSessionRepository).findByIdInAndEndedAtIsNotNull(any());

        reconciler.reconcilePeriodically();

        ArgumentCaptor<Collection<UUID>> asked = ArgumentCaptor.forClass(Collection.class);
        verify(focusSessionRepository, times(2)).findByIdInAndEndedAtIsNotNull(asked.capture());
        assertThat(asked.getAllValues().get(1)).contains(open.getId());
        // 그리고 실제로 회수된다.
        verify(focusPresencePort).releaseLeaseNow(userId, open.getId());
    }

    @Test
    @DisplayName("되묻기가 터져도 기동·다음 회차를 막지 않는다")
    void requeryFailureIsSwallowed() {
        FocusSession open = openMarker(UUID.randomUUID());
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of(open));
        willThrow(new IllegalStateException("db down"))
                .given(focusSessionRepository).findByIdInAndEndedAtIsNotNull(any());

        assertThatCode(() -> reconciler(INLINE).onApplicationReady()).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("주기 진입점도 같은 재구축을 돈다 — 기동 때 실패한 리스를 되찾는 유일한 경로다")
    void periodicEntryPointRunsTheSameReconciliation() {
        UUID userId = UUID.randomUUID();
        FocusSession open = openMarker(userId);
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(any())).willReturn(List.of(open));

        // 기동 리스너와 달리 «제자리에서» 돈다 — 스케줄러 풀이 이미 별도 스레드다.
        reconciler(NEVER_RUNS).reconcilePeriodically();

        verify(focusPresencePort).restoreLeaseIfMissing(userId, open.getId(), open.getStartedAt());
    }

    @Test
    @DisplayName("주기 진입점에 크론과 ShedLock 이름이 붙어 있다 — 떼면 「기동 한 번」으로 조용히 되돌아간다")
    void periodicEntryPointIsScheduledAndLocked() throws NoSuchMethodException {
        Method entry = FocusPresenceReconciler.class.getMethod("reconcilePeriodically");

        assertThat(entry.getAnnotation(Scheduled.class)).isNotNull()
                .extracting(Scheduled::cron).asString().isNotBlank();
        assertThat(entry.getAnnotation(SchedulerLock.class)).isNotNull()
                .extracting(SchedulerLock::name).isEqualTo("focus-presence-reconcile");
    }

    private FocusSession markerStartedAt(UUID userId, java.time.Instant startedAt) {
        return FocusSession.builder()
                .id(UUID.randomUUID())
                .user(User.builder().id(userId).build())
                .startedAt(startedAt)
                .build();
    }

    private FocusSession openMarker(UUID userId) {
        return FocusSession.builder()
                .id(UUID.randomUUID())
                .user(User.builder().id(userId).build())
                .startedAt(NOW.minusSeconds(600))
                .build();
    }
}

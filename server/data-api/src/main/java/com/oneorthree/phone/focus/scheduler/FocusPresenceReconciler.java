package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.service.FocusService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.SimpleAsyncTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

/**
 * 기동 시 <b>DB 정본에서 집중 프레즌스 리스를 재구축</b>한다 (GROMO-292).
 *
 * <h2>없으면 무슨 일이 나는가</h2>
 * 리스는 {@code startFocusSession} 이 지날 때만 놓인다. 그래서 <b>그 순간에 이미 진행 중이던 집중</b>은
 * 리스가 없다:
 * <ul>
 *   <li>{@code focus.presence.enabled} 를 처음 켤 때 — 켜기 전에 시작한 사람들은 세션이 끝날 때까지
 *       <b>집중 중인데 채팅에 들어가고 발신할 수 있다.</b> 롤아웃 창 전체가 규칙 밖이 된다</li>
 *   <li>Redis 를 비웠거나 데이터가 날아갔을 때 — 같은 이유로 그 시점의 모든 진행 중 집중이 규칙 밖이 된다</li>
 * </ul>
 *
 * <h2>왜 이게 «해도 되는 일»이 아니라 «해야 하는 일»인가</h2>
 * 목표 아키텍처 A19 가 공유 저장소에 못 박은 규칙이 그것이다 — <b>Redis 는 사본이라 소유자가 DB
 * 정본에서 재구축할 수 있어야 한다.</b> 이 클래스가 프레즌스 쪽의 그 재구축 경로다.
 *
 * <h2>기동을 «절대» 막지 않는다 — 세 겹으로</h2>
 * 재구축은 부가 작업이라, 실패하든 느리든 코어 API 의 기동을 붙잡으면 안 된다. 그런데 그 규율은
 * 순진하게 짜면 세 곳에서 깨진다:
 * <ol>
 *   <li><b>동기 실행</b> — Redis 가 연결을 드롭하면 진행 중 유저 수만큼 타임아웃을 차례로 기다린다.
 *       N 명이면 기동이 N 배 늦어져 readiness 와 배포를 수십 초~수 분 막는다.
 *       → 별도 스레드로 넘긴다(리스너는 즉시 반환한다).</li>
 *   <li><b>메서드에 붙인 {@code @Transactional}</b> — 조회가 영속성 예외를 내면 트랜잭션이
 *       rollback-only 로 표시되고, 메서드가 반환된 «뒤» 인터셉터가 {@code UnexpectedRollbackException}
 *       을 던진다. 그건 메서드 안의 catch 밖이라 <b>삼켜지지 않는다.</b>
 *       → {@code TransactionOperations} 로 경계를 안으로 넣고 실패를 그 «바깥»에서 처리한다.</li>
 *   <li><b>트랜잭션 안에서 쓰기</b> — 리스 쓰기가 커밋 콜백으로 밀려 한 트랜잭션의 커밋 시점에
 *       전부 몰린다. 조회 트랜잭션을 닫고 «밖에서» 써야 각 쓰기가 곧바로 실행된다.</li>
 * </ol>
 *
 * <h2>여러 인스턴스가 동시에 돌아도 안전하다</h2>
 * 쓰기가 「더 새로운 세션일 때만」인 조건부 연산이라 같은 값을 여러 번 써도 결과가 같고, 그 사이 끝난
 * 세션은 «끝났다» 표식에 걸려 되살아나지 않는다({@code RedisFocusPresence}). 그래서 ShedLock 으로
 * 한 대만 돌게 묶지 않는다 — 묶으면 그 한 대가 실패했을 때 아무도 재구축하지 않는다.
 *
 * <p>기동 시 한 번만 돈다. 운영 중 Redis 가 비는 경우는 재기동이 덮는다 — 주기 실행으로 넓히려면
 * 그때는 잡 등록부(ShedLock)로 옮기는 편이 낫다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "focus.presence.enabled", havingValue = "true")
public class FocusPresenceReconciler {

    private final FocusSessionRepository focusSessionRepository;
    private final FocusPresencePort focusPresencePort;
    private final TransactionOperations transactionOperations;
    private final AsyncTaskExecutor applicationTaskExecutor;
    private final Clock clock;

    /**
     * 재구축 전용 스레드를 <b>스스로</b> 만든다.
     *
     * <p>공용 실행기에 얹고 싶었지만 이 애플리케이션에는 그런 게 없다 — {@code ga4Executor}·
     * {@code pushExecutor} 가 {@code Executor} 빈으로 있어서 Boot 의 {@code applicationTaskExecutor}
     * 자동 구성이 통째로 물러나 있다 — 그 자동 구성은 {@code Executor} 빈이 하나라도 있으면 켜지지 않는다
     * ({@code config/AsyncConfig} 의 주석이 그 사실을 이미 적어 두고 있다).
     * 그래서 타입으로 받든 이름으로 받든 «주입할 빈이 없어» 기동이 깨진다 — 실제로 이 자리에서 한 번
     * 깨졌고, {@code FocusPresenceWiringIntegrationTest} 가 그걸 잡은 테스트다.
     *
     * <p>남은 후보는 스케줄러 풀뿐인데 거긴 얹으면 안 된다 — 이 한 번짜리 작업이 Redis 타임아웃으로
     * 늘어지면 같은 풀의 정각 잡(고아 스윕 등)이 그만큼 밀린다. 그래서 전용 스레드 하나가 답이다.
     * 기동 때 한 번 쓰고 끝나므로 풀을 유지할 이유도 없다.
     *
     * <p>생성자가 둘이라 {@code @Autowired} 로 어느 쪽을 쓸지 못 박아야 한다 — 없으면 Spring 이
     * 기본 생성자를 찾다 실패한다.
     */
    @Autowired
    public FocusPresenceReconciler(
            FocusSessionRepository focusSessionRepository,
            FocusPresencePort focusPresencePort,
            TransactionOperations transactionOperations,
            Clock clock) {
        this(focusSessionRepository, focusPresencePort, transactionOperations,
                new SimpleAsyncTaskExecutor("focus-presence-reconcile-"), clock);
    }

    /** 테스트용 — 실행기를 「제자리 실행」으로 바꿔 재구축 내용을 결정적으로 단언한다. */
    FocusPresenceReconciler(
            FocusSessionRepository focusSessionRepository,
            FocusPresencePort focusPresencePort,
            TransactionOperations transactionOperations,
            AsyncTaskExecutor applicationTaskExecutor,
            Clock clock) {
        this.focusSessionRepository = focusSessionRepository;
        this.focusPresencePort = focusPresencePort;
        this.transactionOperations = transactionOperations;
        this.applicationTaskExecutor = applicationTaskExecutor;
        this.clock = clock;
    }

    /** 기동을 붙잡지 않는다 — 재구축 전체를 별도 스레드로 넘기고 즉시 반환한다. */
    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        applicationTaskExecutor.execute(this::reconcile);
    }

    /**
     * 진행 중(미종료) 마커에 리스를 다시 놓는다.
     *
     * <p><b>모수는 「아직 orphan 이 아닌」 것뿐이다.</b> 「미종료 전부」로 잡으면 이미 12시간을 넘겨
     * 스윕을 기다리는 세션까지 딸려 오고, 그 리스를 다시 놓으면 TTL 이 <b>지금부터</b> 13시간으로
     * 재설정된다 — 실제로는 끝난 집중 때문에 다음 스윕까지(스윕이 또 실패하면 더 오래) 채팅이 막힌다.
     *
     * <p>유저당 열린 마커가 1개라 이 조회는 <b>동시 집중 인원</b> 규모다.
     *
     * <p>이미 끝난 집중을 되살릴 걱정은 없다 — 조회 조건이 {@code endedAt IS NULL} 이고, 조회와
     * 쓰기 사이에 끝난 세션은 그 종료가 남긴 표식에 걸려 쓰기가 거부된다.
     */
    void reconcile() {
        List<FocusSession> alive;
        try {
            alive = readAliveMarkers();
        } catch (RuntimeException e) {
            // 트랜잭션 «경계 밖»이라 UnexpectedRollbackException 도 여기서 잡힌다.
            log.error("집중 프레즌스 재구축 실패(조회) — 그 시점의 진행 중 집중은 채팅이 열린 상태로 남는다", e);
            return;
        }

        // 트랜잭션이 «닫힌 뒤» 쓴다 — 안에서 쓰면 커밋 콜백으로 밀려 한 시점에 전부 몰린다.
        int restored = 0;
        for (FocusSession session : alive) {
            if (session.getUser() != null) {
                focusPresencePort.focusStarted(session.getUser().getId(), session.getId());
                restored++;
            }
        }
        log.info("집중 프레즌스 재구축 — 진행 중 세션 {}건", restored);
    }

    private List<FocusSession> readAliveMarkers() {
        Instant threshold = clock.instant().minus(FocusService.ORPHAN_TIMEOUT);
        return transactionOperations.execute(status ->
                focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(threshold));
    }
}

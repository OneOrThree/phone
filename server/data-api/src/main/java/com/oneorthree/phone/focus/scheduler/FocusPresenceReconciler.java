package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.service.FocusService;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.SimpleAsyncTaskExecutor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

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
 * <h2>기동 «한 번»으로는 모자란다 — 그래서 주기적으로도 돈다</h2>
 * 기동 시점의 한 번은 그 순간 Redis 가 흔들리고 있으면 그대로 끝난다. 쓰기 실패는 계약상 삼켜지므로
 * (부가 기능이 집중을 막으면 안 된다) <b>아무도 알아채지 못한 채</b> 그날 진행 중이던 사람들은 세션이
 * 끝날 때까지 집중 중에도 채팅이 열린다. Redis 가 몇 분 뒤 정상으로 돌아와도 마찬가지다 — 다시
 * 시도하는 주체가 없기 때문이다. 운영 중 Redis 가 비워지는 경우(플러시·축출)도 같은 구멍이다.
 *
 * <p>그래서 주기 실행을 둔다. <b>재시도 로직을 따로 짜지 않는 것이 핵심</b>이다 — 실패를 감지해
 * 백오프로 되돌아오는 코드는 「몇 번까지·얼마나 오래」를 정해야 하고 그 답은 항상 틀린다. 주기 실행은
 * 실패를 감지할 필요가 없다: 다음 회차가 정본을 다시 읽어 어긋난 것만 채운다.
 *
 * <p>주기 실행이 안전한 이유는 재구축 쓰기가 <b>「비어 있을 때만 채운다」</b>이기 때문이다
 * ({@code FocusPresencePort#restoreLeaseIfMissing}). 있는 리스의 TTL 을 밀지 않으므로 매 회차가
 * 무해하고, 그 사이 끝난 세션은 «끝났다» 표식에 걸려 되살아나지 않는다.
 *
 * <p>여러 인스턴스에서 중복으로 돌 이유는 없어 다른 크론과 같이 ShedLock 으로 묶는다. 한 대가
 * 실패해도 다음 회차에 다른 대가 락을 잡으므로 「그 한 대가 죽으면 아무도 안 한다」가 아니다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "focus.presence.enabled", havingValue = "true")
public class FocusPresenceReconciler {

    /** 조회 상한(초). 근거는 {@link #readOnlyWithTimeout} 에 있다. */
    private static final int READ_TIMEOUT_SECONDS = 10;

    /** 되묻기 대기 목록 상한. 근거는 {@link #rememberForNextCycle} 에 있다. */
    private static final int MAX_PENDING_RECHECK = 1_000;

    /**
     * 되묻기가 <b>실패한</b> 세션 id — 다음 회차가 다시 든다.
     *
     * <p>이게 없으면 되묻기 조회가 한 번 터진 세션은 영영 회수되지 않는다. 그 세션은 이미
     * {@code endedAt} 이 차서 진행 중 조회에 다시는 잡히지 않고, 되묻기 후보는 「이번 회차가 방금
     * 쓴 것」뿐이기 때문이다. 남는 백스톱이 TTL 하나가 되어 <b>최대 13시간 채팅이 막힌다.</b>
     *
     * <p>인스턴스 안에만 있는 상태다 — 재기동하면 사라지고, 다른 인스턴스는 모른다. 그래도 되는
     * 이유는 이게 «추가» 재시도이지 유일한 수단이 아니어서다(정상 경로는 종료 자신의 해제다).
     */
    private final Set<UUID> pendingRecheck = ConcurrentHashMap.newKeySet();

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
            PlatformTransactionManager transactionManager,
            Clock clock) {
        this(focusSessionRepository, focusPresencePort, readOnlyWithTimeout(transactionManager),
                new SimpleAsyncTaskExecutor("focus-presence-reconcile-"), clock);
    }

    /**
     * 조회에 <b>시간 상한</b>을 건다.
     *
     * <p>이 조회는 «아무도 기다리지 않는» 스레드에서 돈다. HTTP 요청이라면 톰캣·클라이언트 타임아웃이
     * 결국 끊어 주지만 여기엔 그런 바깥 경계가 없어서, DB 가 응답 없이 걸리면 이 스레드와 커넥션 하나가
     * <b>영영 묶인다</b>. 주기 실행이라 그런 회차가 쌓일 수도 있다(ShedLock 의 {@code lockAtMostFor} 는
     * 락만 풀지 스레드를 끊지 않는다).
     *
     * <p>{@value #READ_TIMEOUT_SECONDS}초는 넉넉하다 — 조회 모수가 부분 인덱스
     * ({@code idx_focus_sessions_live_marker}, {@code WHERE ended_at IS NULL})의 크기,
     * 즉 <b>동시 집중 인원</b>이다.
     *
     * <p>읽기 전용으로 여는 것은 의도다. 이 트랜잭션 안에서는 아무것도 쓰지 않는다 — 리스 쓰기는
     * 트랜잭션이 «닫힌 뒤»에 한다.
     */
    private static TransactionOperations readOnlyWithTimeout(PlatformTransactionManager transactionManager) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setReadOnly(true);
        template.setTimeout(READ_TIMEOUT_SECONDS);
        return template;
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

    /** 기동을 붙잡지 않는다 — 재구축 전체를 전용 스레드로 넘기고 즉시 반환한다. */
    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        applicationTaskExecutor.execute(this::reconcile);
    }

    /**
     * 주기 재구축 — <b>기동 때의 실패를 되찾는 유일한 경로</b>다.
     *
     * <p>여기서는 전용 스레드로 넘기지 않는다. 스케줄러 풀(6스레드)이 그 역할이고, 늦어져도 막히는
     * 것은 다른 크론뿐이지 기동·readiness 가 아니다. {@code lockAtMostFor} 기본 10분이 상한이다.
     *
     * <p>5분 주기는 다른 크론과 맞춘 값이다. 이 값이 곧 <b>「Redis 가 살아난 뒤 규칙이 다시 걸리기까지」</b>
     * 의 상한이다.
     */
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "focus-presence-reconcile")
    public void reconcilePeriodically() {
        reconcile();
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
     *
     * <p>쓰기가 <b>「비어 있을 때만」</b>이라 몇 번을 돌려도 무해하다 — 이 성질이 주기 실행을
     * 가능하게 하는 전부다. 「있으면 갱신」이었다면 매 회차가 TTL 을 밀어, 고아 스윕이 멈춘 동안
     * 끝난 집중이 채팅을 막는 창이 13시간에서 25시간으로 늘어난다.
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
        List<UUID> restored = new ArrayList<>();
        for (FocusSession session : alive) {
            if (session.getUser() != null) {
                focusPresencePort.restoreLeaseIfMissing(session.getUser().getId(), session.getId(),
                        session.getStartedAt());
                restored.add(session.getId());
            }
        }
        log.info("집중 프레즌스 재구축 — 진행 중 세션 {}건", restored.size());

        // 지난 회차가 되묻지 못한 것들을 함께 싣는다 — 그것들은 이미 endedAt 이 차서 위 조회에
        // 다시는 잡히지 않으므로, 여기서 다시 들지 않으면 «영영» 회수되지 않는다.
        List<UUID> candidates = new ArrayList<>(restored);
        candidates.addAll(pendingRecheck);
        releaseWhatEndedMeanwhile(candidates);
    }

    /**
     * 방금 놓아 준 리스 중 <b>그 사이 끝난 세션의 것</b>을 회수한다.
     *
     * <p><b>왜 필요한가.</b> 재구축은 「읽고 → 쓴다」라 그 사이에 세션이 끝날 수 있다. 보통은 종료가
     * 남긴 «끝났다» 표식이 늦은 쓰기를 막지만, <b>그 종료의 Redis 쓰기가 실패했다면 표식이 없다</b> —
     * 그리고 그게 정확히 이 재구축이 존재하는 이유인 「Redis 장애」 중에 벌어지는 일이다. 표식 없이
     * 리스가 놓이면 <b>이미 끝난 집중이 13시간 채팅을 막고</b>, 다음 회차 조회는 {@code endedAt} 이
     * 찬 행을 제외하므로 <b>아무도 그 리스를 치우지 않는다.</b>
     *
     * <p>즉 이 되묻기가 없으면, <b>재구축이 스스로 만든 고장을 스스로는 못 고친다.</b>
     *
     * <p>비용은 한 번의 IN 조회다 — 모수가 방금 쓴 id 목록이라 동시 집중 인원 규모를 넘지 않는다.
     * 회수 자체는 조건부 삭제({@code focusEnded})라 그 사이 새로 시작된 집중의 리스는 건드리지 않는다.
     */
    private void releaseWhatEndedMeanwhile(List<UUID> candidates) {
        if (candidates.isEmpty()) {
            return;
        }
        List<FocusSession> ended;
        try {
            ended = transactionOperations.execute(status ->
                    focusSessionRepository.findByIdInAndEndedAtIsNotNull(candidates));
        } catch (RuntimeException e) {
            // 다음 회차가 다시 든다. 여기서 그냥 포기하면 이 세션들은 «두 번 다시» 후보에 오르지
            // 않는다 — 이미 endedAt 이 차서 진행 중 조회에 안 잡히기 때문이다. 그러면 남는 백스톱은
            // TTL 뿐이고, 그건 10분이 아니라 «시작 기준 13시간»이다.
            rememberForNextCycle(candidates);
            log.error("집중 프레즌스 되묻기 실패 — 다음 회차에 다시 시도한다(대기 {}건)", pendingRecheck.size(), e);
            return;
        }
        // 확인이 끝났으므로 대기 목록에서 뺀다. 아직 진행 중인 것은 다음 회차의 재구축이 다시 싣는다.
        candidates.forEach(pendingRecheck::remove);

        for (FocusSession session : ended) {
            if (session.getUser() != null) {
                focusPresencePort.focusEnded(session.getUser().getId(), session.getId());
            }
        }
        if (!ended.isEmpty()) {
            log.info("집중 프레즌스 되묻기 — 그 사이 끝난 세션 {}건 회수", ended.size());
        }
    }

    /**
     * 되묻기 대기 목록에 넣는다 — <b>상한을 둔다.</b>
     *
     * <p>DB 가 오래 흔들리면 매 회차가 후보를 쌓기만 한다. 그 목록이 무한히 자라면 이 컴포넌트가
     * 장애를 «메모리 누수»로 번역하는 셈이 된다. 상한을 넘으면 더 담지 않고 TTL 백스톱에 맡긴다 —
     * 부가 기능이 코어를 해치지 않는다는 이 클래스의 규율과 같은 방향이다.
     */
    private void rememberForNextCycle(List<UUID> candidates) {
        for (UUID id : candidates) {
            if (pendingRecheck.size() >= MAX_PENDING_RECHECK) {
                log.warn("되묻기 대기 목록 상한({}) 도달 — 나머지는 TTL 백스톱에 맡긴다", MAX_PENDING_RECHECK);
                return;
            }
            pendingRecheck.add(id);
        }
    }

    private List<FocusSession> readAliveMarkers() {
        Instant threshold = clock.instant().minus(FocusService.ORPHAN_TIMEOUT);
        return transactionOperations.execute(status ->
                focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(threshold));
    }
}

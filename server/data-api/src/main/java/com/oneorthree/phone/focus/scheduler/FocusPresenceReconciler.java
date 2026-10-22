package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.FocusPresenceState;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.repository.FocusSessionControlState;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.service.FocusPresenceProjection;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * DB의 진행 중 세션을 기준으로 누락된 집중 프레즌스 리스를 복구한다.
 *
 * <p>기동 시에는 전용 실행기로 넘겨 애플리케이션 시작을 지연시키지 않는다. 이후 5분마다
 * ShedLock 아래 재실행해 Redis 장애나 데이터 유실 후에도 복구한다.
 *
 * <p>DB 조회에는 읽기 전용 트랜잭션과 시간 상한을 적용하고, 리스는 그 트랜잭션 밖에서 쓴다.
 * 기존 리스는 갱신하지 않으며 복구 직후 DB를 다시 읽어 그 사이 종료된 세션의 리스를 해제한다.
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
     * <p><b>수용한 한계 — 인스턴스 안에만 있다.</b> 재기동하면 사라지고, 다중화하면
     * 다음 회차에 락을 잡는 다른 대는 이 목록을 모른다. 그러면 그 세션은 진행 중 조회에도 안 잡혀
     * 남는 백스톱이 TTL 하나가 된다.
     *
     * <p>여기까지 오려면 <b>넷이 겹쳐야 한다</b>: ① 종료 자신의 Redis 쓰기가 실패(그래서 표식이 없다)
     * ② 그 사이 재구축이 리스를 복원(즉 그 시점엔 Redis 가 살아 있다) ③ 되묻기 해제가 또 실패
     * ④ 그 위에 5분 안에 재기동. ②와 ③이 서로 반대 상태를 요구하는 점이 이 창을 특히 좁게 만든다.
     *
     * <p><b>티켓을 내지 않고 여기 적는 이유</b>는, 닫는 값이 지금은 균형에 안 맞기 때문이다 — 회수
     * 대상을 메모리가 아니라 정본에서 찾아야 하는데 {@code ended_at} 인덱스 신설이 선행이고
     * ({@code CREATE INDEX CONCURRENTLY} 는 Flyway 트랜잭션 밖이다), <b>그 조회 비용이 하필 장애
     * 중에 가장 커진다.</b> 백로그에 얹으면 언젠가 「인덱스 하나 추가하는 일」로 보여 그 대가가
     * 사라진 채 처리될 위험이 있다. <b>다중화가 안건이 되면 GROMO-1743 과 함께 다시 볼 것.</b>
     */
    private final Set<UUID> pendingRecheck = ConcurrentHashMap.newKeySet();

    private final FocusSessionRepository focusSessionRepository;
    /** 진행 중 마커의 <b>절대 상태·전이 번호</b>를 읽는다 — 마커만으로는 휴식인지 알 수 없다(GROMO-2003). */
    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusPresenceProjection focusPresenceProjection;
    private final TransactionOperations transactionOperations;
    private final AsyncTaskExecutor applicationTaskExecutor;
    private final Clock clock;


    /**
     * 재구축 전용 스레드를 <b>스스로</b> 만든다.
     *
     * <p>기동 복구는 전용 실행기로 격리해 정각 크론과 요청 처리를 지연시키지 않는다.
     *
     * <p>생성자가 둘이라 {@code @Autowired} 로 어느 쪽을 쓸지 못 박아야 한다 — 없으면 Spring 이
     * 기본 생성자를 찾다 실패한다.
     */
    @Autowired
    public FocusPresenceReconciler(
            FocusSessionRepository focusSessionRepository,
            FocusSessionDetailRepository focusSessionDetailRepository,
            FocusPresenceProjection focusPresenceProjection,
            PlatformTransactionManager transactionManager,
            Clock clock) {
        this(focusSessionRepository, focusSessionDetailRepository, focusPresenceProjection,
                readOnlyWithTimeout(transactionManager),
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
            FocusSessionDetailRepository focusSessionDetailRepository,
            FocusPresenceProjection focusPresenceProjection,
            TransactionOperations transactionOperations,
            AsyncTaskExecutor applicationTaskExecutor,
            Clock clock) {
        this.focusSessionRepository = focusSessionRepository;
        this.focusSessionDetailRepository = focusSessionDetailRepository;
        this.focusPresenceProjection = focusPresenceProjection;
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
    @Scheduled(cron = "0 */5 * * * *", zone = ZonePolicy.KST_ID)
    @SchedulerLock(name = "focus-presence-reconcile")
    public void reconcilePeriodically() {
        reconcile();
    }

    /**
     * 12시간 이내에 시작한 미종료 세션의 누락된 리스를 복구한다.
     *
     * <p>기존 리스와 종료 표식은 그대로 유지한다. 조회와 복구 사이 종료된 세션은 되묻기로 확인하고,
     * 해제하지 못한 리스는 다음 회차에 다시 처리한다.
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

        List<FocusSession> targets = newestPerUser(alive);
        Map<UUID, FocusSessionControlState> controls;
        try {
            controls = readControlStates(targets);
        } catch (RuntimeException e) {
            // 상세를 못 읽으면 「휴식인데 active 로 되살리는」 위험이 남는다 — 이번 회차를 통째로
            // 건너뛰고 다음 회차에 다시 든다. 리스를 «비어 있을 때만» 채우므로 미루는 대가는 5분이다.
            log.error("집중 프레즌스 재구축 실패(상태 조회) — 다음 회차에 다시 시도한다", e);
            return;
        }

        // 트랜잭션이 «닫힌 뒤» 쓴다 — 안에서 쓰면 커밋 콜백으로 밀려 한 시점에 전부 몰린다.
        List<UUID> restored = new ArrayList<>();
        for (FocusSession session : targets) {
            FocusSessionControlState control = controls.get(session.getId());
            if (control == null || (control.lifecycle() != FocusSessionLifecycle.ACTIVE
                    && control.lifecycle() != FocusSessionLifecycle.PAUSED)) {
                focusPresenceProjection.releaseLeaseNow(session.getUser().getId(), session.getPresenceOrder());
                continue;
            }
            if (!focusPresenceProjection.restoreLeaseIfMissing(session.getUser().getId(),
                    session.getPresenceOrder(), control.version(), stateOf(control),
                    session.getStartedAt())) {
                // 저장소가 흔들린다. 남은 건을 이어 가면 «각각» 타임아웃을 기다려, 부가 기능의 장애가
                // 스케줄러 슬롯을 인원수배로 점유한다 — 같은 풀의 다른 크론이 그만큼 밀린다.
                // 응답 타임아웃이어도 Redis 쓰기는 성사됐을 수 있다. 그 사이 종료된 세션은 다음
                // 진행 중 조회에서 빠지므로, 실패한 이번 시도도 되묻기 후보에 남긴다.
                rememberForNextCycle(List.of(session.getId()));
                log.warn("집중 프레즌스 재구축 중단(저장소 실패) — {}건 중 {}건까지, 다음 회차가 이어 간다",
                        alive.size(), restored.size());
                break;
            }
            restored.add(session.getId());
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
        Set<UUID> endedIds = ended.stream().map(FocusSession::getId).collect(Collectors.toSet());
        // 아직 «진행 중»으로 확인된 후보는 여기서 뺀다 — 다음 회차의 재구축이 다시 싣는다.
        candidates.stream().filter(id -> !endedIds.contains(id)).forEach(pendingRecheck::remove);

        int reclaimed = 0;
        List<UUID> postponed = new ArrayList<>();
        boolean storageDown = false;
        for (FocusSession session : ended) {
            if (storageDown) {
                // 첫 실패 뒤로는 «시도조차» 하지 않는다 — 각 건이 타임아웃을 하나씩 더 기다린다.
                postponed.add(session.getId());
                continue;
            }
            if (session.getUser() == null) {
                // 누구의 리스인지 알 수 없어 다시 시도해도 소용이 없다.
                pendingRecheck.remove(session.getId());
                continue;
            }
            // 「지웠는가」를 확인하고 뺀다. 조회가 성공해도 해제가 실패할 수 있는데(그쪽은 별개의
            // Redis 연산이다), 그걸 성공으로 치고 빼면 그 세션은 진행 중 조회에도 안 잡히고
            // 대기 목록에도 없어 «아무도» 리스를 못 치운다 — 시작 기준 13시간 차단이다.
            if (focusPresenceProjection.releaseLeaseNow(session.getUser().getId(),
                    session.getPresenceOrder())) {
                pendingRecheck.remove(session.getId());
                reclaimed++;
            } else {
                storageDown = true;
                postponed.add(session.getId());
            }
        }
        rememberForNextCycle(postponed);
        if (!ended.isEmpty()) {
            log.info("집중 프레즌스 되묻기 — 끝난 세션 {}건 중 {}건 회수(대기 {}건)",
                    ended.size(), reclaimed, pendingRecheck.size());
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
        if (candidates.isEmpty()) {
            return;
        }
        for (UUID id : candidates) {
            if (pendingRecheck.size() >= MAX_PENDING_RECHECK) {
                log.warn("되묻기 대기 목록 상한({}) 도달 — 나머지는 TTL 백스톱에 맡긴다", MAX_PENDING_RECHECK);
                return;
            }
            pendingRecheck.add(id);
        }
    }

    /**
     * 사용자별로 가장 최근에 시작한 기본 세션 하나를 선택한다.
     *
     * <p>이전 데이터나 테스트 스키마에 열린 세션이 여러 개 있어도 선택 기준을 일정하게 유지한다.
     * 시작 시각이 같으면 더 큰 id를 선택한다.
     */
    private static List<FocusSession> newestPerUser(List<FocusSession> markers) {
        Map<UUID, FocusSession> newest = new LinkedHashMap<>();
        for (FocusSession marker : markers) {
            if (marker.getUser() == null) {
                // 누구의 리스인지 알 수 없다 — 놓을 수도, 지울 수도 없다.
                continue;
            }
            newest.merge(marker.getUser().getId(), marker,
                    (kept, candidate) -> isNewer(candidate, kept) ? candidate : kept);
        }
        return List.copyOf(newest.values());
    }

    private static boolean isNewer(FocusSession candidate, FocusSession kept) {
        int byStart = candidate.getStartedAt().compareTo(kept.getStartedAt());
        return byStart != 0 ? byStart > 0 : candidate.getId().compareTo(kept.getId()) > 0;
    }

    /**
     * 진행 중 기본 세션의 상세 상태와 전이 번호를 한 번에 읽는다.
     *
     * <p>상세가 없는 이전 기록은 결과에서 제외된다. 리스 쓰기는 조회 트랜잭션이 닫힌 뒤 수행한다.
     */
    private Map<UUID, FocusSessionControlState> readControlStates(List<FocusSession> markers) {
        if (markers.isEmpty()) {
            return Map.of();
        }
        List<UUID> ids = markers.stream().map(FocusSession::getId).toList();
        List<FocusSessionControlState> rows = transactionOperations.execute(status ->
                focusSessionDetailRepository.findControlStatesBySessionIdIn(ids));
        Map<UUID, FocusSessionControlState> byId = new LinkedHashMap<>();
        for (FocusSessionControlState row : rows) {
            byId.put(row.sessionId(), row);
        }
        return byId;
    }

    /** 활성 상세의 집중·휴식 상태를 그대로 투영한다. */
    private static FocusPresenceState stateOf(FocusSessionControlState control) {
        return control.lifecycle() == FocusSessionLifecycle.PAUSED
                ? FocusPresenceState.PAUSED : FocusPresenceState.ACTIVE;
    }

    private List<FocusSession> readAliveMarkers() {
        Instant threshold = clock.instant().minus(java.time.Duration.ofHours(12));
        return transactionOperations.execute(status ->
                focusSessionRepository.findByEndedAtIsNullAndStartedAtAfter(threshold));
    }
}

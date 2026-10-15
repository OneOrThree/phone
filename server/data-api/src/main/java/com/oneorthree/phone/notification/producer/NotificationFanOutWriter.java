package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.outbox.dto.EventEnvelope;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 배치 판정이 끝난 알림 요청을 <b>짧은 트랜잭션 조각</b>으로 나눠 outbox 에 적는다 (GROMO-893).
 *
 * <h2>왜 판정 트랜잭션에 합류하지 않는가</h2>
 * USER aggregate 잠금은 트랜잭션이 끝날 때까지 유지된다. 리그·재참여·복귀처럼 전역 사용자를 여러 페이지로
 * 훑는 배치가 한 트랜잭션에서 적으면 ① 페이지마다 따로 정렬해도 트랜잭션 전체의 잠금 순서는 섞여 다른
 * 배치·요청과 교착하고, ② 수만 명의 USER 행을 배치가 끝날 때까지 쥐어 그 사이 로그인·토큰 갱신이 같은
 * 행에서 멈춘다.
 *
 * <p>그래서 판정(후보 스냅샷)은 호출부 트랜잭션에 그대로 두고, 적기만 조각마다 새 트랜잭션에서 한다.
 * 각 조각은 자기 수신자만 정본 순서로 잠그고 커밋과 함께 놓는다 — 조각이 쥔 잠금은 언제나 한 조각 분량이다.
 *
 * <h2>실패한 조각은 «같은 요청»으로 다시 적는다 — 재판정하지 않는다</h2>
 * 조각이 {@code 40001}·{@code 40P01} 로 롤백되면 이미 판정된 그 요청들을 새 트랜잭션에서 다시 적는다. 배치 전체를
 * 새 스냅샷으로 다시 돌리면, 앞 조각이 커밋한 사용자의 상태가 그사이 바뀌었을 때 <b>다른 종류</b>의 알림이 같은
 * 슬롯에 또 적힌다(강등 경고를 받은 사용자에게 마감 D-1 이 한 번 더). 조각 트랜잭션이 없던 때에는 앞 페이지도
 * 함께 롤백됐으므로 «RR 후보 판정의 의미»가 그 성질을 지켰다 — 조각 재시도가 그것을 이어받는다.
 *
 * <p>조각이 멈추면 — 재시도가 소진됐든 잠금 충돌이 아닌 실패든 — 이 배치에서 이미 커밋된 조각이 있는지 본다. 있으면
 * {@link NotificationFanOutPartiallyCommittedException} 을 던져 배치 재시도가 재판정하지 못하게 하고 운영자에게 재생
 * 좌표를 남긴다. 아직 아무 조각도 커밋되지 않았으면 원래 실패를 그대로 올린다 — 부분 쓰기가 없으므로 잠금 충돌이면 배치
 * 전체를 다시 판정해도 안전하고, 그 밖의 실패는 원래대로 다시 돌지 않는다.
 *
 * <h2>producer 를 {@code REQUIRES_NEW} 로 만들지 않는다</h2>
 * 요청 경로(챌린지 개설·정산·친구 요청)는 도메인 커밋과 사건이 <b>같은 트랜잭션</b>이어야 한다. 새
 * 트랜잭션 경계는 «판정 전용 배치» 인 이 클래스에만 둔다.
 */
@Slf4j
@Component
public class NotificationFanOutWriter {

    /** 한 조각이 잠그는 수신자 수 상한. */
    static final int CHUNK_RECIPIENTS = 200;

    /** 조각을 같은 요청으로 다시 적을 때마다 올리는 지표. 태그: {@code sqlState}. */
    public static final String CHUNK_RETRY_METRIC = "notification.fanout.chunk.retry";

    /** 조각 재시도 소진 지표. 태그: {@code sqlState}. */
    public static final String CHUNK_EXHAUSTED_METRIC = "notification.fanout.chunk.retry.exhausted";

    private final NotificationOutboxProducer producer;
    private final TransactionTemplate chunkTransaction;
    private final NotificationFanOutProgress progress;
    private final ObjectProvider<MeterRegistry> meterRegistry;
    private final int maxAttempts;

    public NotificationFanOutWriter(NotificationOutboxProducer producer,
                                    PlatformTransactionManager transactionManager,
                                    NotificationFanOutProgress progress,
                                    ObjectProvider<MeterRegistry> meterRegistry,
                                    @Value("${notification.fanout.chunk-max-attempts:3}") int maxAttempts) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("조각 쓰기 시도 횟수는 1 이상이어야 한다: " + maxAttempts);
        }
        this.producer = producer;
        this.progress = progress;
        this.meterRegistry = meterRegistry;
        this.maxAttempts = maxAttempts;
        this.chunkTransaction = new TransactionTemplate(transactionManager);
        // 판정 트랜잭션이 열려 있어도 조각은 그 밖에서 커밋해야 잠금이 조각 끝에서 풀린다.
        this.chunkTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * 요청을 조각으로 나눠 적는다.
     *
     * <p>조각은 {@code unit} 의 원자 단위를 절대 가르지 않는다. 한 단위가 상한보다 커도 쪼개지 않고 한 조각에
     * 담는다 — 묶음이 갈리는 쪽이 잠금이 조금 길어지는 쪽보다 나쁘다.
     *
     * @param requests 판정이 끝난 요청
     * @param unit     갈라서는 안 되는 묶음 단위
     * @return 입력 순서 그대로의 결과 — {@code QUEUED} 또는 {@code DUPLICATE}
     * @throws NotificationFanOutPartiallyCommittedException 이 배치에서 앞 조각이 커밋된 뒤 조각이 실패했을 때
     */
    public List<NotificationDispatchOutcome> write(List<NotificationRequest> requests, NotificationFanOutUnit unit) {
        NotificationDispatchOutcome[] outcomes = new NotificationDispatchOutcome[requests.size()];
        Map<Object, List<Integer>> units = new LinkedHashMap<>();
        for (int index = 0; index < requests.size(); index++) {
            units.computeIfAbsent(unit.keyOf(requests.get(index)), ignored -> new ArrayList<>()).add(index);
        }
        int committedHere = 0;
        List<Integer> chunk = new ArrayList<>();
        Set<UUID> recipients = new LinkedHashSet<>();
        for (List<Integer> members : units.values()) {
            Set<UUID> unitRecipients = new LinkedHashSet<>();
            members.forEach(index -> unitRecipients.add(requests.get(index).userId()));
            Set<UUID> merged = new LinkedHashSet<>(recipients);
            merged.addAll(unitRecipients);
            if (!chunk.isEmpty() && merged.size() > CHUNK_RECIPIENTS) {
                writeChunk(requests, chunk, outcomes, committedHere);
                committedHere++;
                chunk = new ArrayList<>();
                recipients = new LinkedHashSet<>();
            }
            chunk.addAll(members);
            recipients.addAll(unitRecipients);
        }
        if (!chunk.isEmpty()) {
            writeChunk(requests, chunk, outcomes, committedHere);
        }
        return List.of(outcomes);
    }

    /**
     * 조각 하나를 적는다 — 잠금 충돌이면 같은 요청으로 새 트랜잭션에서 다시 적는다.
     *
     * @param committedHere 이 {@code write} 호출에서 앞서 커밋된 조각 수(배치 범위가 없을 때의 근거)
     */
    private void writeChunk(List<NotificationRequest> requests, List<Integer> chunk,
                            NotificationDispatchOutcome[] outcomes, int committedHere) {
        List<NotificationRequest> slice = chunk.stream().map(requests::get).toList();
        for (int attempt = 1; ; attempt++) {
            try {
                List<Optional<EventEnvelope>> written = chunkTransaction.execute(status -> producer.appendAll(slice));
                for (int position = 0; position < chunk.size(); position++) {
                    outcomes[chunk.get(position)] = written.get(position).isPresent()
                            ? NotificationDispatchOutcome.QUEUED
                            : NotificationDispatchOutcome.DUPLICATE;
                }
                progress.recordCommittedChunk();
                return;
            } catch (RuntimeException failure) {
                String sqlState = NotificationLockConflicts.sqlStateOf(failure);
                if (sqlState != null && attempt < maxAttempts) {
                    count(CHUNK_RETRY_METRIC, sqlState);
                    log.warn("알림 조각 잠금 충돌 — 같은 요청으로 새 트랜잭션에서 다시 적는다. sqlState={}, attempt={}, 요청 {}건",
                            sqlState, attempt, slice.size());
                    continue;
                }
                if (sqlState != null) {
                    count(CHUNK_EXHAUSTED_METRIC, sqlState);
                }
                // 실패의 종류와 무관하다 — 앞 조각이 커밋된 뒤라면 잠금 충돌이 아닌 실패도 재판정하면 안 되는 부분 커밋이다.
                int committed = Math.max(committedHere, progress.committedChunks());
                if (committed > 0) {
                    throw new NotificationFanOutPartiallyCommittedException(committed, sqlState, failure);
                }
                throw failure;
            }
        }
    }

    private void count(String metric, String sqlState) {
        MeterRegistry registry = meterRegistry.getIfAvailable();
        if (registry != null) {
            registry.counter(metric, "sqlState", sqlState).increment();
        }
    }
}

package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.outbox.dto.EventEnvelope;
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
 * 각 조각은 자기 수신자만 정본 순서로 잠그고 커밋과 함께 놓는다 — 조각이 쥔 잠금은 언제나 한 조각
 * 분량이다. 결정적 사건 키가 있으므로 일부 조각만 커밋된 뒤 배치 전체가 다시 돌아도 이미 적힌 사건은
 * 중복으로 접힌다.
 *
 * <h2>producer 를 {@code REQUIRES_NEW} 로 만들지 않는다</h2>
 * 요청 경로(챌린지 개설·정산·친구 요청)는 도메인 커밋과 사건이 <b>같은 트랜잭션</b>이어야 한다. 새
 * 트랜잭션 경계는 «판정 전용 배치» 인 이 클래스에만 둔다.
 */
@Component
public class NotificationFanOutWriter {

    /** 한 조각이 잠그는 수신자 수 상한. */
    static final int CHUNK_RECIPIENTS = 200;

    private final NotificationOutboxProducer producer;
    private final TransactionTemplate chunkTransaction;

    public NotificationFanOutWriter(NotificationOutboxProducer producer,
                                    PlatformTransactionManager transactionManager) {
        this.producer = producer;
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
     */
    public List<NotificationDispatchOutcome> write(List<NotificationRequest> requests, NotificationFanOutUnit unit) {
        NotificationDispatchOutcome[] outcomes = new NotificationDispatchOutcome[requests.size()];
        Map<Object, List<Integer>> units = new LinkedHashMap<>();
        for (int index = 0; index < requests.size(); index++) {
            units.computeIfAbsent(unit.keyOf(requests.get(index)), ignored -> new ArrayList<>()).add(index);
        }
        List<Integer> chunk = new ArrayList<>();
        Set<UUID> recipients = new LinkedHashSet<>();
        for (List<Integer> members : units.values()) {
            Set<UUID> unitRecipients = new LinkedHashSet<>();
            members.forEach(index -> unitRecipients.add(requests.get(index).userId()));
            Set<UUID> merged = new LinkedHashSet<>(recipients);
            merged.addAll(unitRecipients);
            if (!chunk.isEmpty() && merged.size() > CHUNK_RECIPIENTS) {
                writeChunk(requests, chunk, outcomes);
                chunk = new ArrayList<>();
                recipients = new LinkedHashSet<>();
            }
            chunk.addAll(members);
            recipients.addAll(unitRecipients);
        }
        if (!chunk.isEmpty()) {
            writeChunk(requests, chunk, outcomes);
        }
        return List.of(outcomes);
    }

    private void writeChunk(List<NotificationRequest> requests, List<Integer> chunk,
                            NotificationDispatchOutcome[] outcomes) {
        List<NotificationRequest> slice = chunk.stream().map(requests::get).toList();
        List<Optional<EventEnvelope>> written = chunkTransaction.execute(status -> producer.appendAll(slice));
        for (int position = 0; position < chunk.size(); position++) {
            outcomes[chunk.get(position)] = written.get(position).isPresent()
                    ? NotificationDispatchOutcome.QUEUED
                    : NotificationDispatchOutcome.DUPLICATE;
        }
    }
}

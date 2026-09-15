package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 알림 요청을 <b>내구 이벤트</b>로 적는 유일한 자리 (A21 · A22 · 계약 §5).
 *
 * <h2>같은 트랜잭션</h2>
 * {@link OutboxCommandPort#append} 는 {@code Propagation.MANDATORY} 다. 그래서 이 클래스도
 * {@code MANDATORY} 로 호출부의 트랜잭션에 <b>반드시 합류</b>한다 — 별도 트랜잭션으로 열리면
 * 「도메인이 롤백돼도 알림만 나간다」는 정확히 반대 방향의 사고가 난다.
 *
 * <h2>{@code AFTER_COMMIT} 을 쓰지 않는 이유</h2>
 * 요청형 알림(친구 요청·챌린지 개설·회차 종료)의 구 경로는 {@code @TransactionalEventListener
 * (AFTER_COMMIT)} 이다. 커밋과 리스너 사이에 프로세스가 죽으면 <b>그 알림은 아무 흔적 없이 사라진다</b>
 * — 재훑기가 있는 내기 계열만 겨우 회수된다. 새 경로는 {@code BEFORE_COMMIT} 동기 리스너에서
 * 이 producer 를 불러 <b>도메인 커밋과 같은 원자 단위</b>로 outbox 행을 남기고, 실제 발행은 relay 가
 * 트랜잭션 밖에서 한다.
 *
 * <h2>중복 키는 「이미 있다」로 접는다</h2>
 * {@code append} 는 같은 {@code eventId} 두 번이면 UNIQUE 위반으로 죽는다 — 그 판단은 호출부
 * 몫이라고 명시돼 있다. 알림 사건은 <b>결정적 키</b>라 재훑기·중복 크론이 같은 키를 다시 만드는 것이
 * 정상 동작이므로, 여기서 먼저 조회해 있으면 그대로 둔다. 이것이 구 경로의 선점
 * ({@code notification_sent_logs} UNIQUE)을 대체한다.
 *
 * <p>조회는 쓰기 키 하나가 아니라 {@link NotificationEventKey#duplicateKeysOf} 가 주는 <b>대조 목록</b>
 * 으로 한다 — 시간축이 고정 버킷이라 같은 사건이 경계에서 갈릴 수 있기 때문이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationOutboxProducer {

    /**
     * 찾은 행이 <b>정말로</b> 같은 사건인가 — 넓힌 대조를 실제 폭으로 되돌리는 층.
     *
     * <h2>왜 키만으로는 모자란가</h2>
     * 쓰기 버킷 하나만 보면 경계에서 같은 사건이 갈리므로({@code 12:00:59} 와 {@code 12:01:01})
     * {@link NotificationEventKey#duplicateKeysOf} 가 인접 버킷까지 넓힌다. 그런데 <b>인접 버킷은
     * 통째로</b> 딸려 온다. {@code 12:01:59} 에 쓰면서 {@code 12:00} 버킷을 보면 118초 전의
     * {@code 12:00:01} 사건이 잡힌다 — 거절된 뒤 <b>다시 보낸 친구 요청</b>이 「중복」으로 사라진다.
     * {@code FriendNotificationService} 가 말하는 창은 1분이지 2분이 아니다.
     *
     * <h2>그래서 두 층으로 나눈다</h2>
     * 키는 <b>넓게</b> 찾고(경계에서 놓치지 않기 위해), 찾은 행은 <b>실제 시각</b>으로 거른다.
     * 한 층으로 합치려 하면 둘 중 하나를 포기하게 된다 — 좁히면 경계에서 중복 푸시가 나가고,
     * 넓히면 재요청 통보가 사라진다.
     *
     * <p><b>쓰기 버킷에서 찾은 행은 그대로 중복이다.</b> 그 버킷은 넓힌 것이 아니라 이 사건이 실제로
     * 속한 칸이고, 같은 칸에 든 둘은 정의상 같은 사건이다. 시각 비교는 <b>넓혀서 딸려 온</b> 인접
     * 버킷에만 적용한다.
     *
     * @param request   적으려는 요청
     * @param candidate 지금 대조한 키
     * @param candidates 대조 목록 — 첫 원소가 쓰기 버킷이다
     * @param existing  그 키로 찾은 행
     * @return 실제 dedup 창 안인가
     */
    private boolean withinDedupWindow(NotificationRequest request, String candidate, List<String> candidates,
            EventOutbox existing) {
        if (candidate.equals(candidates.get(0))) {
            return true;
        }
        Instant occurredAt = request.occurredAtKeyHint();
        Instant previous = dedupAtOf(existing);
        if (occurredAt == null || previous == null) {
            // 시각을 알 수 없으면 «넓힌 쪽»을 믿는다. 이 경로는 dedupAt 이 실리기 전에 적힌 행에만
            // 해당하고, 그때의 동작(버킷 단위로 접기)이 그대로 유지되는 것이 맞다 — 배포 순간에
            // 갑자기 중복 푸시가 나가는 편보다 낫다.
            return true;
        }
        return Duration.between(occurredAt, previous).abs()
                .compareTo(NotificationSlotGranularity.MINUTE_WIDTH) <= 0;
    }

    /** @return 그 행이 적힐 때의 «원본 사건 시각». 실리지 않았거나 모양이 다르면 {@code null} */
    private static Instant dedupAtOf(EventOutbox existing) {
        Object raw = existing.getParams() == null ? null : existing.getParams().get(DEDUP_AT);
        if (raw == null) {
            return null;
        }
        try {
            return Instant.parse(raw.toString());
        } catch (DateTimeParseException malformed) {
            return null;
        }
    }

    /**
     * 중복 판정이 실제 폭을 재는 데 쓰는 «원본 사건 시각» 필드.
     *
     * <p>봉투의 {@code occurredAt} 은 append 시각이라 이 용도로 못 쓴다 — 재훑기가 옛 사건을 지금
     * 적으면 둘이 크게 갈린다. 소비 측은 이 필드를 쓰지 않는다(모르는 필드는 무시한다).
     */
    static final String DEDUP_AT = "dedupAt";

    /** 정본 봉투의 {@code type} — 알림 요청은 한 종류다. 실제 종류는 {@code params.kind} 가 가른다. */
    public static final String EVENT_TYPE = "notification.requested";

    /** 봉투 스키마 버전(ⓦ). 필드를 더할 때는 올리지 않는다 — additive 는 같은 버전이다. */
    static final int SCHEMA_VERSION = 1;

    private final OutboxCommandPort outboxCommandPort;
    private final EventOutboxRepository eventOutboxRepository;
    private final ResultBundleCompletionService resultBundles;

    /**
     * 알림 요청 하나를 outbox 에 적는다 — <b>호출부의 도메인 트랜잭션 안에서</b>.
     *
     * @param request 판정이 끝난 요청
     * @return 새로 적었으면 그 봉투. 같은 결정적 키가 <b>이미 있으면</b> {@link Optional#empty()} —
     *     호출부는 이것을 「중복 감지」로 세고 실패로 다루지 않는다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<EventEnvelope> append(NotificationRequest request) {
        String eventId = eventIdOf(request);
        resultBundles.protect(request);
        AggregateRef aggregate = AggregateRef.ofUser(request.userId());
        // 「있으면 두고 없으면 적는다」는 조회와 삽입 사이에 창이 있다. 그 창에 같은 결정적 키가
        // 동시에 들어오면 둘 다 「없다」를 보고 둘 다 INSERT 해, 한쪽이 UNIQUE 위반으로 죽으면서
        // «도메인 트랜잭션 전체»를 되돌린다 — 중복 알림 하나를 막으려다 정산·친구 요청이 롤백된다.
        //
        // 그래서 조회 «전에» 유저 축 행을 배타 잠금한다. 이 유저의 알림 사건은 이 지점에서
        // 직렬화되므로 뒤따르는 조회가 앞선 삽입을 반드시 본다. 잠금은 트랜잭션이 끝날 때까지 유지된다.
        //
        // 대가는 version 번호가 띈다는 것이다(중복이라 append 하지 않은 호출도 번호를 하나 쓴다).
        // 소비 측은 «단조 증가»만 보고 «연속»에 기대지 않으므로 빈 번호는 무해하다.
        outboxCommandPort.allocateVersion(aggregate);
        // 쓰기 키 하나만 보지 않는다. 시간축이 고정 버킷이라 «같은 사건»이 버킷 경계에서 갈릴 수 있고
        // (분 축의 12:00:59 와 12:01:01), 그때 쓰기 키만 조회하면 「없다」가 나와 같은 사건이 두 번
        // 적힌다 = 푸시가 두 번 나간다. 어디까지 대조하는지는 시간축이 정한다.
        List<String> candidates = NotificationEventKey.duplicateKeysOf(request.kind(), request.userId(),
                request.subjectId(), request.occurredAtKeyHint());
        for (String candidate : candidates) {
            Optional<EventOutbox> existing = eventOutboxRepository.findByEventId(candidate);
            if (existing.isPresent() && withinDedupWindow(request, candidate, candidates, existing.get())) {
                // 재훑기·겹치는 크론이 같은 사건을 다시 집은 것 — 정상이다.
                return Optional.empty();
            }
        }
        // scheduledAt 은 언제나 null 이다 — 이월(DEFER)은 «발행»을 미루는 일이 아니라 «발송»을 미루는
        // 일이고, 그 판정에 필요한 조용한 시간 설정의 정본은 알림 DB 에 있다. relay 를 붙잡아 두면
        // 설정이 그사이 바뀌어도 이미 박힌 시각으로 나가고, Kafka 에 아직 없는 사건은 알림 서버가
        // 상태(설정 삭제·탈퇴·ack)를 반영할 기회조차 갖지 못한다.
        resultBundles.register(request, eventId);
        EventEnvelope envelope = outboxCommandPort.append(new OutboxAppendCommand(
                eventId,
                SCHEMA_VERSION,
                EVENT_TYPE,
                request.userId(),
                request.locale(),
                request.subjectId() == null ? null : request.subjectId().toString(),
                aggregate,
                null,
                paramsOf(request),
                List.of(OutboxDeliveryRequest.toKafka())));
        return Optional.of(envelope);
    }

    /**
     * 여러 수신자의 요청을 <b>한 트랜잭션에서</b> 적는다 — 수신자 전원을 정본 순서로 먼저 잠근 뒤 적는다
     * (GROMO-893).
     *
     * <h2>왜 {@link #append} 를 루프로 부르면 안 되는가</h2>
     * {@link #append} 는 수신자 USER 행을 잠그고 그 잠금은 트랜잭션 끝까지 간다. 루프 순서대로 하나씩 잠그면
     * 순서가 다른 두 트랜잭션(공통 멤버를 가진 두 그룹의 챌린지 개설, 같은 사용자를 다른 정렬로 훑는 두
     * 배치)이 A→B · B→A 로 교착해 PostgreSQL 이 한쪽 트랜잭션 «전체»를 {@code 40P01} 로 되돌린다.
     *
     * <h2>잠금 순서 — 결과 슬롯 공유 잠금 → USER 잠금</h2>
     * 결과·환불 요청의 슬롯 공유 잠금을 USER 보다 먼저 전부 잡는다. 거꾸로 USER 를 쥔 채 공유 잠금을
     * 요청하면, 앞서 대기 중인 봉인의 배타 잠금 뒤에 줄을 서게 되고 그 봉인은 USER 를 기다리는 정산의
     * 공유 잠금이 풀리길 기다려 셋이 순환한다. 정산({@code settlementTime})도 공유 잠금을 USER 보다 먼저 잡는다.
     *
     * @param requests 판정이 끝난 요청들 — 수신자 중복·순서 무관
     * @return 입력 순서 그대로 — 새로 적었으면 봉투, 같은 결정적 키가 이미 있으면 {@link Optional#empty()}
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<Optional<EventEnvelope>> appendAll(List<NotificationRequest> requests) {
        if (requests.isEmpty()) {
            return List.of();
        }
        requests.forEach(resultBundles::protect);
        outboxCommandPort.lockUserAggregates(requests.stream().map(NotificationRequest::userId).toList());
        List<Optional<EventEnvelope>> written = new ArrayList<>(requests.size());
        for (NotificationRequest request : requests) {
            written.add(append(request));
        }
        return written;
    }

    /**
     * 결정적 사건 키 — {@code noti:<kind>:<userId>:<subjectId|none>:<시간축|none>}.
     *
     * <p>네 축이 전부 필요하다. kind 가 없으면 같은 회차의 결과와 환불이 한 건으로 접히고, userId 가
     * 없으면 fan-out 이 첫 수신자 한 명으로 줄고, subjectId 가 없으면 서로 다른 회차가 뭉치고,
     * 시간축이 없으면 매일 반복되는 알림이 첫날 이후 안 나간다.
     *
     * @param request 요청
     * @return 결정적 키
     */
    String eventIdOf(NotificationRequest request) {
        return NotificationEventKey.of(request.kind(), request.userId(), request.subjectId(),
                request.occurredAtKeyHint());
    }

    /**
     * 봉투 {@code params} 조립 — kind·묶음 메타·조용한 시간 정책을 공통으로 얹고 그 위에 렌더 입력을 둔다.
     *
     * <p>렌더 입력이 공통 키를 덮지 못하게 <b>공통을 나중에 넣는다</b> — {@code params.kind} 가
     * 호출부 실수로 바뀌면 알림 서버가 다른 템플릿으로 렌더한다.
     *
     * @param request 요청
     * @return 봉투에 실릴 params
     */
    private Map<String, Object> paramsOf(NotificationRequest request) {
        Map<String, Object> params = new LinkedHashMap<>(request.params());
        params.put("kind", request.kind().name());
        params.put("quietPolicy", request.kind().quietPolicy().name());
        if (request.groupId() != null) {
            params.put("groupId", request.groupId().toString());
        }
        if (request.slotAt() != null) {
            params.put("slotAt", request.slotAt().toString());
        }
        if (request.occurredAtKeyHint() != null) {
            // 중복 판정이 «실제 1분»을 재려면 이 값이 행에 남아 있어야 한다. 봉투의 occurredAt 은
            // append 시각이라 못 쓴다 — 재훑기가 옛 사건을 지금 적으면 둘이 크게 갈린다.
            // 계약상 params 는 additive 허용이고(additionalProperties: true) 소비자는 모르는 필드를
            // 무시하므로 스키마 버전은 올리지 않는다.
            NotificationExpiry.addTo(params, request.kind(), request.occurredAtKeyHint());
        }
        return params;
    }
}

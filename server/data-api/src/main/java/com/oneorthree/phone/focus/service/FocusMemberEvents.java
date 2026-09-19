package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 섬 집중·휴식 목록 사건 {@code focus.member.updated}·{@code rest.member.updated} 의 유일한 발행자 (GROMO-1953).
 *
 * <p>수명주기 전이({@code FocusSessionLifecycleService})와 소속 상실 종결({@link FocusMembershipLossService})이
 * 같은 두 사건을 적는다. 사건 이름·순서 축·params 모양이 두 곳에서 갈라지면 소비측이 같은
 * {@code (projection, islandId, userId)} 축으로 합칠 수 없어 여기 한 곳에 둔다.
 *
 * <p>축은 {@code (섬, 사용자)} 이고 세션이 바뀌어도 초기화하지 않는다(realtime-events LLD §2 #1·#2). params 의
 * {@code sessionVersion} 은 REST 세션 낙관락 값이라 봉투 {@code version} 과 다른 축이다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class FocusMemberEvents {

    public static final String FOCUS_AGGREGATE_TYPE = "FOCUS_MEMBER";
    public static final String REST_AGGREGATE_TYPE = "REST_MEMBER";
    public static final String FOCUS_EVENT_TYPE = "focus.member.updated";
    public static final String REST_EVENT_TYPE = "rest.member.updated";
    /** 세션이 끝나 목록에서 지운다는 상태값 — LLD §6 의 {@code completed}(행 제거)다. */
    public static final String STATUS_COMPLETED = "completed";

    private final OutboxCommandPort outbox;

    /** 집중 목록의 한 주민 상태가 바뀌었다. */
    public EventEnvelope focusUpdated(UUID userId, UUID islandId, UUID sessionId, String status, String subject,
                                      long activeSeconds, Instant serverNow, long sessionVersion) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", userId.toString());
        params.put("sessionId", sessionId.toString());
        params.put("status", status);
        params.put("subject", subject);
        params.put("activeSeconds", activeSeconds);
        params.put("serverNow", serverNow.toString());
        params.put("sessionVersion", sessionVersion);
        return append(FOCUS_EVENT_TYPE, FOCUS_AGGREGATE_TYPE, userId, islandId, params);
    }

    /**
     * 휴식 목록의 한 주민 상태가 바뀌었다. nullable 필드는 키를 유지한다(LLD §6) — active/completed 전이는
     * {@code restStartedAt}/{@code restSeat}=null 로 「이 사용자를 rest 목록에서 지운다」를 나타낸다.
     */
    public EventEnvelope restUpdated(UUID userId, UUID islandId, UUID sessionId, String status,
                                     Instant restStartedAt, Integer restSeat, Instant serverNow,
                                     long sessionVersion) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", userId.toString());
        params.put("sessionId", sessionId.toString());
        params.put("status", status);
        params.put("restStartedAt", restStartedAt == null ? null : restStartedAt.toString());
        params.put("restSeat", restSeat);
        params.put("serverNow", serverNow.toString());
        params.put("sessionVersion", sessionVersion);
        return append(REST_EVENT_TYPE, REST_AGGREGATE_TYPE, userId, islandId, params);
    }

    private EventEnvelope append(String type, String aggregateType, UUID userId, UUID islandId,
                                 Map<String, Object> params) {
        return outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, type, userId, null,
                islandId.toString(), new AggregateRef(aggregateType, islandId + ":" + userId), null, params,
                List.of(OutboxDeliveryRequest.toRealtime(type, null))));
    }
}

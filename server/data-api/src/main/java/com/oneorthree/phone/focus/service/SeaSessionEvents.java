package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 바다 방 사건 {@code sea.member.updated} 의 유일한 발행자 (GROMO-2299, 바다 항해 계약 §4).
 *
 * <p>바다 세션 start({@code sailing})·finish({@code ended})와 한마디 변경({@code remark})이 각자 명령 트랜잭션 안에서
 * 적는다. 순서 축은 {@code USER(userId)}, {@code subjectId} 는 사용자 id 다 — 바다에는 섬이 없어 realtime 은 이 값으로
 * 사용자의 방을 찾는다. 「정박 중」은 사건이 아니다(수신 측이 {@code activeSeconds ≥ sailingMinutes×60} 으로 판정).
 *
 * <p>앱으로 나가지 않는 내부 제어 사건이라 realtime-events 14종 공개 계약에 속하지 않는다.
 *
 * <p><b>생산 스위치 {@code focus.sea.realtime-events-enabled}(기본 false).</b> 이 type 을 모르는 옛 Realtime 에 보내면
 * 400 → relay 가 그 사용자의 USER 축을 permanent 로 막는다 — USER 축은 {@code user.withdrawn} 과 같은 축이라 탈퇴
 * 전파까지 막힌다({@code UserBlockEvents} 와 같은 함정). Realtime 이 이 type 을 받는 버전으로 배포된 것을 확인한 뒤
 * env 로 켠다. 꺼져 있으면 적지 않고 빈 목록을 돌려준다.
 */
@Service
@Transactional(propagation = Propagation.MANDATORY)
public class SeaSessionEvents {

    public static final String EVENT_TYPE = "sea.member.updated";
    public static final String STATUS_SAILING = "sailing";
    public static final String STATUS_ENDED = "ended";
    public static final String STATUS_REMARK = "remark";

    /** 스위치가 꺼져 건너뛴 사건 수 — 켠 뒤 «왜 방에 안 보이나» 를 가르는 근거. */
    public static final String SKIPPED_METRIC = "focus.sea.events.skipped";

    private final OutboxCommandPort outbox;
    private final ObjectProvider<MeterRegistry> meterRegistry;
    private final boolean enabled;

    public SeaSessionEvents(OutboxCommandPort outbox, ObjectProvider<MeterRegistry> meterRegistry,
            @Value("${focus.sea.realtime-events-enabled:false}") boolean enabled) {
        this.outbox = outbox;
        this.meterRegistry = meterRegistry;
        this.enabled = enabled;
    }

    /** 바다 세션이 시작됐다. */
    public List<EventEnvelope> sailing(UUID userId, UUID sessionId, UUID destinationIslandId, int sailingMinutes,
                                       Instant serverNow) {
        return append(userId, STATUS_SAILING + ":" + sessionId, STATUS_SAILING, sessionId, destinationIslandId,
                sailingMinutes, 0L, null, null, serverNow);
    }

    /** 바다 세션이 정산됐다 — {@code arrived} 는 항해 시간을 채웠는가. */
    public List<EventEnvelope> ended(UUID userId, UUID sessionId, UUID destinationIslandId, int sailingMinutes,
                                     long activeSeconds, boolean arrived, Instant serverNow) {
        return append(userId, STATUS_ENDED + ":" + sessionId, STATUS_ENDED, sessionId, destinationIslandId,
                sailingMinutes, activeSeconds, arrived, null, serverNow);
    }

    /**
     * 한마디가 바뀌었다 — 지웠으면 {@code remark} 는 {@code ""} 다(null 로 보내지 않는다 — realtime 은 {@code ""}·null
     * 둘 다 지움으로 받지만 키 부재는 불량으로 보고 무시한다. 저장값 {@code sea_remarks.remark=""} 과도 같다).
     */
    public List<EventEnvelope> remark(UUID userId, String remark, Instant changedAt) {
        return append(userId, STATUS_REMARK + ":" + userId + ":" + changedAt.toEpochMilli(), STATUS_REMARK, null,
                null, null, 0L, null, remark == null ? "" : remark, changedAt);
    }

    private List<EventEnvelope> append(UUID userId, String key, String status, UUID sessionId,
                                       UUID destinationIslandId, Integer sailingMinutes, long activeSeconds,
                                       Boolean arrived, String remark, Instant serverNow) {
        if (!enabled) {
            MeterRegistry registry = meterRegistry.getIfAvailable();
            if (registry != null) {
                registry.counter(SKIPPED_METRIC, "status", status).increment();
            }
            return List.of();
        }
        // null 값 키를 유지한다(계약 §4) — Map.of 는 null 을 못 담는다.
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("status", status);
        params.put("sessionId", sessionId == null ? null : sessionId.toString());
        params.put("destinationIslandId", destinationIslandId == null ? null : destinationIslandId.toString());
        params.put("sailingMinutes", sailingMinutes);
        params.put("activeSeconds", activeSeconds);
        params.put("arrived", arrived);
        params.put("remark", remark);
        params.put("serverNow", serverNow.toString());
        return List.of(outbox.append(new OutboxAppendCommand(EVENT_TYPE + ":" + key, 1, EVENT_TYPE, userId, null,
                userId.toString(), AggregateRef.ofUser(userId), null, params,
                List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null)))));
    }
}

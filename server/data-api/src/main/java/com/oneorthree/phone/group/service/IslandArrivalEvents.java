package com.oneorthree.phone.group.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.user.repository.domain.User;
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
 * 주민 첫 도착 사건 {@code island.member.arrived} 의 유일한 발행자 (GROMO-2302, 바다 항해 후속 계약 §1.3).
 *
 * <p>{@code POST /islands/{id}/arrivals} 가 «현 가입 이후 주민으로서 처음» 이라고 판정했을 때만 부른다 — 가입과 동시에
 * 옮겨지는 경로(섬 생성·방문 중 가입·초대 도착 등)는 소식이 아니라 부르지 않는다. realtime 이 그 섬
 * {@code /topic/islands/{id}/events} 의 현재 주민에게 전달한다. 주민 전용 채널이라 이름·털색을 싣는다.
 *
 * <p>순서 축은 {@code ISLAND_ARRIVAL(islandId)} 다 — {@code ISLAND} 축과 <b>나누는 이유</b>: 이 type 을 모르는 옛
 * realtime 이 400 을 돌려주면 relay 가 그 축을 permanent 로 막는다. 축을 공유하면 그 섬의 {@code island.updated}
 * 까지 멈춘다.
 *
 * <p><b>생산 스위치 {@code island.arrival.realtime-events-enabled}(기본 false).</b> realtime 이 이 type 을 받는 버전으로
 * 배포된 것을 확인한 뒤 env 로 켠다. 꺼져 있으면 적지 않고 빈 목록을 돌려준다.
 */
@Service
@Transactional(propagation = Propagation.MANDATORY)
public class IslandArrivalEvents {

    public static final String EVENT_TYPE = "island.member.arrived";
    public static final String AGGREGATE_TYPE = "ISLAND_ARRIVAL";

    /** 스위치가 꺼져 건너뛴 사건 수 — 켠 뒤 «왜 토스트가 안 뜨나» 를 가르는 근거. */
    public static final String SKIPPED_METRIC = "island.arrival.events.skipped";

    private final OutboxCommandPort outbox;
    private final ObjectProvider<MeterRegistry> meterRegistry;
    private final boolean enabled;

    public IslandArrivalEvents(OutboxCommandPort outbox, ObjectProvider<MeterRegistry> meterRegistry,
            @Value("${island.arrival.realtime-events-enabled:false}") boolean enabled) {
        this.outbox = outbox;
        this.meterRegistry = meterRegistry;
        this.enabled = enabled;
    }

    /**
     * 탈퇴 파기 — 이 사건 params 에 복제된 이름·털색을 지운다(outbox-events.md §2.7). 털색도 지우는 근거: 사용자 행의
     * {@code cat_color} 가 «탈퇴 시 파기» 대상이라(V80) 사본만 남길 이유가 없다. 재전달 대기 중인 봉투는 본문을 바꾸지
     * 않고 남는다({@link OutboxCommandPort#eraseWithdrawnParam}). 스위치와 무관하게 부른다 — 켰다 끈 뒤의 행도 지운다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void eraseWithdrawnUser(UUID userId) {
        outbox.eraseWithdrawnParam(userId, EVENT_TYPE, "name");
        outbox.eraseWithdrawnParam(userId, EVENT_TYPE, "catColor");
    }

    /** 주민 {@code user} 가 현 가입 이후 처음 {@code islandId} 에 도착했다. */
    public List<EventEnvelope> arrived(UUID islandId, User user, Instant arrivedAt) {
        if (!enabled) {
            MeterRegistry registry = meterRegistry.getIfAvailable();
            if (registry != null) {
                registry.counter(SKIPPED_METRIC).increment();
            }
            return List.of();
        }
        // 이름·털색은 아직 고르지 않았으면 null — 키는 남긴다(Map.of 는 null 을 못 담는다).
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("islandId", islandId.toString());
        params.put("userId", user.getId().toString());
        params.put("name", user.getNickname());
        params.put("catColor", user.getCatColor());
        params.put("arrivedAt", arrivedAt.toString());
        // eventId 는 무작위다 — realtime 이 UUID.fromString 으로 읽는다. 중복은 receipt 재생이 work 를 다시 돌리지 않아 0.
        return List.of(outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, EVENT_TYPE,
                user.getId(), null, islandId.toString(), new AggregateRef(AGGREGATE_TYPE, islandId.toString()),
                null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null)))));
    }
}

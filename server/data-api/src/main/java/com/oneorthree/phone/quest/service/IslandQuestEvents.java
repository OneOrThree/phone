package com.oneorthree.phone.quest.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.quest.repository.domain.IslandQuestOccurrence;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * {@code quest.progress.updated} 의 유일한 발행자 (LLD §6) — 축은 (섬, 퀘스트, 회차)이고 aggregate id 가
 * 회차 id 다(회차 id 가 전역 유일이라 세 값을 다 싣지 않아도 축이 같다). 봉투의 version 이 곧 회차
 * {@code version} 이다 — 호출측이 반환 봉투의 version 을 회차에 싣는다.
 *
 * <p>outbox 에 REALTIME 대상으로 적는다. relay 가 {@code application-satellites.yml} 의 {@code [quest.progress.updated]}
 * 목적지(HTTP, {@code realtime-kafka-enabled} 면 {@code realtime-events} 토픽)로 보내고, Realtime 은
 * {@code /topic/islands/{islandId}/events} 로 방송한다. 2026-11-09 기준 앱은 이 타입을 구독하지 않아 무시한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandQuestEvents {

    public static final String AGGREGATE_TYPE = "ISLAND_QUEST_PROGRESS";
    public static final String EVENT_TYPE = "quest.progress.updated";

    private final OutboxCommandPort outbox;

    public EventEnvelope progressUpdated(IslandQuestOccurrence occurrence, UUID actorId) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("islandId", occurrence.getIslandId().toString());
        params.put("questId", occurrence.getQuestId().toString());
        params.put("occurrenceId", occurrence.getId().toString());
        EventEnvelope envelope = outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, EVENT_TYPE,
                actorId, null, occurrence.getIslandId().toString(),
                new AggregateRef(AGGREGATE_TYPE, occurrence.getId().toString()),
                null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
        return envelope;
    }
}

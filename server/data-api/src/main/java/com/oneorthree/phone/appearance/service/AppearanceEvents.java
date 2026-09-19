package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.repository.domain.IslandAppearance;
import com.oneorthree.phone.appearance.repository.domain.PersonalAppearance;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 외양 도메인의 사건 writer — 호출 TX 안에서 event_outbox 와 REALTIME delivery 행을 함께 적는다.
 *
 * <p>OutboxCommandService 와 같은 저장 형식을 쓰되 aggregate version 을 발급하지 않는다 — 외양
 * 버전은 잠금 아래 외양 행 자체가 매기므로(행 잠금 == 버전 발급) 별도 발급 축을 두면 두 시계가 생긴다.
 * 개인 외양은 표시 대상 섬마다 별개 eventId 를 적으나 같은 외양 버전을 공유하고, (user, island) 축별로는
 * 단조 증가다 — events 는 「적어도 한 번」이므로 재전송·재정렬 수신은 앱이 (userId, islandId) 축 버전으로
 * 걸러야 한다(문서 계약). 이벤트 바이트는 receipt 에도 같은 객체로 들어가 재생이 그대로 돌려준다.
 */
@Component
@RequiredArgsConstructor
public class AppearanceEvents {

    public static final String EVENT_MEMBER_APPEARANCE = "member.appearance.updated";
    public static final String EVENT_ISLAND_APPEARANCE = "island.appearance.updated";
    public static final String EVENT_PLAYBACK = "playback.updated";

    static final String AGGREGATE_USER_APPEARANCE = "USER_APPEARANCE";
    static final String AGGREGATE_ISLAND_APPEARANCE = "ISLAND_APPEARANCE";
    static final String AGGREGATE_USER_INVENTORY = "USER_INVENTORY";
    static final String AGGREGATE_ISLAND_INVENTORY = "ISLAND_INVENTORY";
    static final String AGGREGATE_ISLAND_PLAYBACK = "ISLAND_PLAYBACK";

    private static final int SCHEMA_VERSION = 1;

    private final EventOutboxRepository eventOutbox;
    private final EventOutboxDeliveryRepository deliveries;
    private final Clock clock;

    /**
     * 개인 외양 변경 — 외양이 표시되는 섬마다 1건씩 적는다. 섬별 eventId 는 다르지만
     * aggregateVersion·payload.appearance·payload.version 은 같은 외양 스냅샷이다.
     *
     * @return receipt.events 에 실을 전송용 봉투 목록(적은 순서대로)
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<Map<String, Object>> memberChanged(UUID userId, List<UUID> islandIds,
                                                   PersonalAppearance appearance) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("userId", userId.toString());
        payload.put("appearance", personalAppearanceMap(appearance));
        payload.put("version", appearance.getVersion());

        List<Map<String, Object>> envelopes = new ArrayList<>();
        for (UUID islandId : islandIds) {
            envelopes.add(append(EVENT_MEMBER_APPEARANCE, userId, islandId.toString(),
                    AGGREGATE_USER_APPEARANCE, userId + ":" + islandId,
                    appearance.getVersion(), payload));
        }
        return envelopes;
    }

    /** 공동 외양 변경 — 해당 섬에 1건 적는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Map<String, Object> islandChanged(UUID islandId, UUID actorId, IslandAppearance appearance) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("islandThemeId", appearance.getIslandThemeId());
        payload.put("buildingThemes", new LinkedHashMap<>(appearance.getBuildingThemes()));
        payload.put("version", appearance.getVersion());
        return append(EVENT_ISLAND_APPEARANCE, actorId, islandId.toString(),
                AGGREGATE_ISLAND_APPEARANCE, islandId.toString(),
                appearance.getVersion(), payload);
    }

    /**
     * 공용 음악 변경 (GROMO-1779) — 축 (playback, islandId), aggregateVersion == payload.version.
     * payload 는 PATCH 응답 data 와 같은 공개 8필드다. 생산 여부는 호출측 게이트가 정한다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Map<String, Object> playbackChanged(UUID islandId, UUID actorId, long version,
                                               Map<String, Object> payload) {
        return append(EVENT_PLAYBACK, actorId, islandId.toString(), AGGREGATE_ISLAND_PLAYBACK,
                islandId.toString(), version, payload);
    }

    // ---------------------------------------------------------------- 공통

    /** outbox + REALTIME delivery 를 한 쌍으로 적고, 저장된 전송용 봉투를 돌려준다. */
    private Map<String, Object> append(String type, UUID actorId, String subjectId,
                                       String aggregateType, String aggregateId, long version,
                                       Map<String, Object> payload) {
        Instant now = clock.instant();
        String eventId = UUID.randomUUID().toString();
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schemaVersion", SCHEMA_VERSION);
        envelope.put("eventId", eventId);
        envelope.put("type", type);
        envelope.put("islandId", subjectId);
        envelope.put("aggregateVersion", version);
        envelope.put("occurredAt", now.toString());
        envelope.put("payload", payload);

        EventOutbox saved = eventOutbox.save(EventOutbox.builder()
                .eventId(eventId)
                .schemaVersion(SCHEMA_VERSION)
                .type(type)
                .occurredAt(now)
                .userId(actorId)
                .subjectId(subjectId)
                .aggregateType(aggregateType)
                .aggregateId(aggregateId)
                .version(version)
                .params(payload)
                .createdAt(now)
                .build());
        deliveries.save(EventOutboxDelivery.builder()
                .outboxId(saved.getId())
                .target(OutboxTarget.REALTIME)
                .aggregateType(aggregateType)
                .aggregateId(aggregateId)
                .aggregateVersion(version)
                .payload(envelope)
                .endpointKey(type)
                .attemptCount(0)
                .nextAttemptAt(now)
                .createdAt(now)
                .build());
        return envelope;
    }

    /** null 이 들어갈 수 있는 슬롯(clothes·decor)을 포함하므로 Map.of 대신 LinkedHashMap 을 쓴다. */
    private static Map<String, Object> personalAppearanceMap(PersonalAppearance a) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("clothes", a.getClothes());
        map.put("decor", a.getDecor());
        map.put("hull", a.getHull());
        map.put("position", a.getPosition());
        return map;
    }
}

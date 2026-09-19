package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.repository.domain.IslandAppearance;
import com.oneorthree.phone.appearance.repository.domain.PersonalAppearance;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
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
 * 외양 도메인의 사건 writer — 호출 TX 안에서 {@link OutboxCommandPort#append(OutboxAppendCommand, long)} 로
 * 정본 봉투와 REALTIME 전달 행을 함께 적는다 (GROMO-1953 전에는 repository 로 직접 적었다).
 *
 * <p>version 은 aggregate_versions 가 아니라 <b>외양·재생 행 자체</b>가 잠금 아래 매긴다(행 잠금 == 버전
 * 발급) — 별도 발급 축을 두면 두 시계가 생겨 {@code params.version} 과 봉투 version 이 어긋난다. 그래서
 * 도메인 version 을 받는 append 를 쓴다. 호출부는 그 행을 배타 잠근 채 부른다.
 *
 * <p>봉투 모양은 다른 어댑터와 같은 10필드 정본({@code subjectId}·{@code version}·{@code params})이다.
 * realtime 7필드({@code islandId}·{@code aggregateVersion}·{@code payload})로 옮기는 일은 realtime 수신 측 몫이다
 * (docs/conventions/outbox-events.md §2.9). {@code params} 는 공개 payload 그대로라 {@code version} 을 담는데,
 * 그 값은 봉투 version 과 같은 도메인 값이다 — 추정 중복이 아니다.
 *
 * <p>개인 외양은 표시 대상 섬마다 별개 eventId 를 적으나 같은 외양 버전을 공유하고, (user, island) 축별로는
 * 단조 증가다 — events 는 「적어도 한 번」이므로 재전송·재정렬 수신은 앱이 (userId, islandId) 축 버전으로
 * 걸러야 한다(문서 계약). 반환 봉투는 receipt 에도 같은 값으로 들어가 재생이 그대로 돌려준다.
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

    private final OutboxCommandPort outbox;

    /**
     * 개인 외양 변경 — 외양이 표시되는 섬마다 1건씩 적는다. 섬별 eventId 는 다르지만
     * version·params.appearance·params.version 은 같은 외양 스냅샷이다.
     *
     * @return receipt.events 에 실을 봉투 목록(적은 순서대로)
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<EventEnvelope> memberChanged(UUID userId, List<UUID> islandIds, PersonalAppearance appearance) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", userId.toString());
        params.put("appearance", personalAppearanceMap(appearance));
        params.put("version", appearance.getVersion());

        List<EventEnvelope> envelopes = new ArrayList<>();
        for (UUID islandId : islandIds) {
            envelopes.add(append(EVENT_MEMBER_APPEARANCE, userId, islandId,
                    new AggregateRef(AGGREGATE_USER_APPEARANCE, userId + ":" + islandId),
                    appearance.getVersion(), params));
        }
        return envelopes;
    }

    /** 공동 외양 변경 — 해당 섬에 1건 적는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public EventEnvelope islandChanged(UUID islandId, UUID actorId, IslandAppearance appearance) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("islandThemeId", appearance.getIslandThemeId());
        params.put("buildingThemes", new LinkedHashMap<>(appearance.getBuildingThemes()));
        params.put("version", appearance.getVersion());
        return append(EVENT_ISLAND_APPEARANCE, actorId, islandId,
                new AggregateRef(AGGREGATE_ISLAND_APPEARANCE, islandId.toString()), appearance.getVersion(), params);
    }

    /**
     * 공용 음악 변경 (GROMO-1779) — 축 (playback, islandId), 봉투 version == params.version.
     * params 는 PATCH 응답 data 와 같은 공개 8필드다. 생산 여부는 호출측 게이트가 정한다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public EventEnvelope playbackChanged(UUID islandId, UUID actorId, long version, Map<String, Object> params) {
        return append(EVENT_PLAYBACK, actorId, islandId,
                new AggregateRef(AGGREGATE_ISLAND_PLAYBACK, islandId.toString()), version, params);
    }

    // ---------------------------------------------------------------- 공통

    /** subjectId 는 전달 범위인 섬이다(규약 §2.9) — 개인 외양도 표시 대상 섬마다 따로 적는다. */
    private EventEnvelope append(String type, UUID actorId, UUID islandId, AggregateRef aggregate, long version,
                                 Map<String, Object> params) {
        return outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), SCHEMA_VERSION, type, actorId,
                null, islandId.toString(), aggregate, null, params,
                List.of(OutboxDeliveryRequest.toRealtime(type, null))), version);
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

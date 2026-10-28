package com.oneorthree.phone.group.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 주민/역할 목록의 독립 버전. REALTIME 전달은 수신/인가/스냅샷 구현 전까지 내구 보류한다. */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandMembershipEvents {
    public static final String AGGREGATE_TYPE = "ISLAND_MEMBERS";
    public static final String EVENT_TYPE = "island.members.updated";
    private final OutboxCommandPort outbox;

    /**
     * 내부 제어 자료이며 공개 payload는 후속 adapter가 islandId와 envelope.version만으로 만든다.
     *
     * <p>방장 위임은 주민 <b>집합</b>이 바뀌지 않는다 — 그래서 {@code memberUserId} 가 없다. Realtime 의
     * 즉시 캐시 무효화(GROMO-2140)는 「이 유저가 이 섬의 멤버인가」 집합만 보므로 이 사건에는 무효화할
     * 대상이 없다.
     */
    public EventEnvelope transferred(UUID islandId, UUID previousHostUserId, UUID hostUserId) {
        return append(islandId, previousHostUserId, Map.of(
                "changeKind", "HOST_TRANSFER", "previousHostUserId", previousHostUserId.toString(),
                "hostUserId", hostUserId.toString()));
    }

    /**
     * 기존 가입/이탈도 같은 목록 버전을 전진시키며 링크 자격 세대와 혼용하지 않는다.
     *
     * <p>발행한 envelope 를 돌려준다(GROMO-1759). 멱등 명령은 확정한 사건을 receipt 에 함께
     * 저장해야 재생이 같은 결과를 재현하는데, 버전은 {@code append} 가 잠금 아래에서 한 번만
     * 발급하므로 호출부가 그 값을 알 방법이 이 반환값뿐이다. 기존 호출부는 반환을 무시한다.
     *
     * @param actorId 이 변화를 일으킨 명령 주체 — envelope 의 {@code userId} 필드(§2.9)가 되며 강퇴처럼
     *                <b>대상 본인이 아닐 수 있다</b>
     * @param memberUserId 실제로 소속이 바뀐 유저 — 강퇴는 대상, 가입/이탈/재가입은 본인이라 대개 actorId 와
     *                      같지만 강퇴·승인처럼 명령 주체가 다르면 갈린다. Realtime 이 이 값으로 그 유저 하나의
     *                      멤버십 캐시만 즉시 지운다(GROMO-2140) — actorId 를 쓰면 강퇴된 사람이 아니라 강퇴한
     *                      방장의 캐시가 지워진다. 식별자일 뿐이라 탈퇴 PII 지움 대상이 아니다(outbox 규약 §2.7).
     */
    public EventEnvelope changed(UUID islandId, UUID actorId, String changeKind, UUID memberUserId) {
        return append(islandId, actorId, Map.of("changeKind", changeKind, "memberUserId", memberUserId.toString()));
    }

    private EventEnvelope append(UUID islandId, UUID actorId, Map<String, Object> details) {
        Map<String, Object> params = new LinkedHashMap<>(details);
        params.put("islandId", islandId.toString());
        // 이 target의 userId는 인증된 명령 주체 참조다. 수신자 권한이나 Kafka fan-out 근거가 아니다.
        // version은 append가 잠금 아래 한 번만 발급한다. params에 추정 버전을 중복 저장하지 않는다.
        return outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, EVENT_TYPE,
                actorId, null, islandId.toString(), new AggregateRef(AGGREGATE_TYPE, islandId.toString()),
                null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
    }
}

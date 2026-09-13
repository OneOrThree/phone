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

    /** 내부 제어 자료이며 공개 payload는 후속 adapter가 islandId와 envelope.version만으로 만든다. */
    public EventEnvelope transferred(UUID islandId, UUID previousHostUserId, UUID hostUserId) {
        return append(islandId, previousHostUserId, Map.of(
                "changeKind", "HOST_TRANSFER", "previousHostUserId", previousHostUserId.toString(),
                "hostUserId", hostUserId.toString()));
    }

    /** 기존 가입/이탈도 같은 목록 버전을 전진시키며 링크 자격 세대와 혼용하지 않는다. */
    public void changed(UUID islandId, UUID actorId, String changeKind) {
        append(islandId, actorId, Map.of("changeKind", changeKind));
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

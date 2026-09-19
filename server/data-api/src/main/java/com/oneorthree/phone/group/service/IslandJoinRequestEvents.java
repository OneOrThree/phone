package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 가입 요청의 개인 사건 {@code join.request.updated} (GROMO-1760 · 섬 소속 LLD §3.7~§3.9).
 *
 * <h2>수신자별 봉투 — fan-out 은 이미 펼쳐진 뒤다</h2>
 * 이 사건은 「요청자 본인 + 그 섬 방장」에게 간다. realtime 의 개인 큐는 봉투의 {@code userId} 를
 * 수신자로 읽으므로, 수신자마다 봉투 하나씩을 같은 트랜잭션에 남긴다 — 두 사람의 사본이 같은
 * 사건을 가리키게 하려면 사건 키를 {@code <전이 키>:<수신자>} 로 나눠 쓴다.
 *
 * <h2>전이 키는 결정적이다</h2>
 * {@code join.request.updated:<requestId>:<recipientUserId>:<status>:<requestVersion>} —
 * 한 요청 행이 같은 상태에 두 번 들어가는 일은 없으므로 (요청, 수신자, 전이 후 상태) 셋이
 * 한 전이를 유일하게 가리킨다. 엔티티 버전은 플러시 전에는 전이 후 값이 아직 아니어서
 * (신규 PENDING 과 첫 전이가 같은 값을 읽는다) 키에는 status 를 함께 쓴다.
 * 멱등 명령의 재생은 저장된 봉투를 돌려줄 뿐 이 append 를 다시 하지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandJoinRequestEvents {

    public static final String AGGREGATE_TYPE = "JOIN_REQUEST";
    public static final String EVENT_TYPE = "join.request.updated";

    private static final int SCHEMA_VERSION = 1;

    private final OutboxCommandPort outbox;

    /**
     * 요청의 상태가 바뀐 사건을 수신자별로 기록한다.
     *
     * @param request    전이가 끝난 요청 — version 은 전이 후 값이어야 한다
     * @param hostUserId 그 섬의 현재 방장 — 없으면(방장 공백 구간) 신청자에게만 간다
     * @return 발행한 봉투들 — 멱등 명령이 receipt 에 함께 저장해 재생을 재현한다
     */
    public List<EventEnvelope> changed(IslandJoinRequest request, UUID hostUserId) {
        UUID applicantId = request.getApplicant().getId();
        List<UUID> recipients = new ArrayList<>(2);
        recipients.add(applicantId);
        if (hostUserId != null && !hostUserId.equals(applicantId)) {
            recipients.add(hostUserId);
        }
        // 사건의 requestVersion 은 전이 «후» 값이다 — 신규 PENDING 은 INSERT 가 v0 으로 시작하고,
        // 기존 행의 전이는 UPDATE 가 +1 한다. 플러시 전 엔티티 값은 전이 «전» 값이라 여기서 보정한다.
        long base = request.getVersion() == null ? 0L : request.getVersion();
        long requestVersion = request.isPending() ? base : base + 1;

        List<EventEnvelope> envelopes = new ArrayList<>(recipients.size());
        for (UUID recipient : recipients) {
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("requestId", request.getId().toString());
            params.put("islandId", request.getIsland().getId().toString());
            params.put("applicantId", applicantId.toString());
            params.put("hostUserId", hostUserId == null ? null : hostUserId.toString());
            params.put("status", request.getStatus().wireName());
            params.put("requestVersion", requestVersion);
            String eventId = EVENT_TYPE + ":" + request.getId() + ":" + recipient + ":"
                    + request.getStatus().wireName() + ":" + requestVersion;
            envelopes.add(outbox.append(new OutboxAppendCommand(eventId, SCHEMA_VERSION, EVENT_TYPE,
                    recipient, null, request.getId().toString(),
                    new AggregateRef(AGGREGATE_TYPE, request.getId().toString()),
                    null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null)))));
        }
        return envelopes;
    }
}

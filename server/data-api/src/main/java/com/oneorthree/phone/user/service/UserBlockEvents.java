package com.oneorthree.phone.user.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 차단 관계 변경을 Realtime 에 내구적으로 알린다 (GROMO-2182).
 *
 * <p>차단·해제와 <b>같은 트랜잭션</b>에서 outbox 에 적으므로 관계가 커밋되면 사건도 반드시 남는다. Realtime 은 이
 * 사건으로 그 차단자의 차단 세대를 올려, 캐시된 옛 집합으로 섬 채팅·응원을 전달하지 않게 한다. 순서 축
 * {@code (USER_BLOCKS, blockerId)} 의 {@code version} 이 곧 그 차단자의 <b>차단 세대</b>다.
 *
 * <p>앱으로 나가지 않는 내부 제어 사건이다 — realtime-events 의 14종 공개 계약에 속하지 않는다. 식별자만
 * 싣고(닉네임 등 PII 없음) 수신자 권한 근거로 쓰지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class UserBlockEvents {

    public static final String EVENT_TYPE = "user.blocks.updated";
    public static final String AGGREGATE_TYPE = "USER_BLOCKS";

    private final OutboxCommandPort outbox;

    /** 실제로 관계가 생겼을 때만 부른다 — 이미 있던 차단의 재요청은 세대를 올릴 이유가 없다. */
    public void blocked(UUID blockerId, UUID blockedId) {
        append(blockerId, blockedId, "BLOCKED");
    }

    /** 실제로 관계가 지워졌을 때만 부른다. */
    public void unblocked(UUID blockerId, UUID blockedId) {
        append(blockerId, blockedId, "UNBLOCKED");
    }

    private void append(UUID blockerId, UUID blockedId, String changeKind) {
        Map<String, Object> params = Map.of(
                "blockerUserId", blockerId.toString(),
                "blockedUserId", blockedId.toString(),
                "changeKind", changeKind);
        outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, EVENT_TYPE, blockerId, null,
                blockerId.toString(), new AggregateRef(AGGREGATE_TYPE, blockerId.toString()), null, params,
                List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
    }
}

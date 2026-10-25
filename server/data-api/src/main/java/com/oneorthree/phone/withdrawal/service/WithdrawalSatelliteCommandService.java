package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
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

/** 탈퇴 사실을 알림·실시간·랭킹 소비자에게 전달하는 내구 사건. */
@Service
@RequiredArgsConstructor
public class WithdrawalSatelliteCommandService {

    /** 사건 종류 — 계정이 탈퇴했다. */
    public static final String EVENT_USER_WITHDRAWN = "user.withdrawn";


    private static final int SCHEMA_VERSION = 1;

    private final OutboxCommandPort outboxCommandPort;

    /**
     * 탈퇴 사건을 적는다 — <b>탈퇴 트랜잭션과 같은 커밋</b>이다.
     *
     * @param userId         탈퇴한 유저
     * @param authGeneration 탈퇴로 올린 <b>뒤</b>의 세대 — 위성이 이보다 오래된 명령을 거부하는 기준
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordWithdrawn(UUID userId, long authGeneration) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", userId.toString());
        params.put("authGeneration", authGeneration);
        outboxCommandPort.append(new OutboxAppendCommand(
                EVENT_USER_WITHDRAWN + ":" + userId,
                SCHEMA_VERSION,
                EVENT_USER_WITHDRAWN,
                userId,
                null,
                userId.toString(),
                AggregateRef.ofUser(userId),
                null,
                params,
                List.of(
                        // 알림 서버는 정본 봉투 그대로 소비한다.
                        OutboxDeliveryRequest.toKafka(),
                        // realtime 은 chat_read_cursors 를 파기하고 커서 쓰기를 막는다(GROMO-1943, 수신
                        // POST /internal/events 또는 realtime-events 토픽 — GROMO-1954). relay 가 꺼져 있으면 이 행은
                        // 미전달로 «보존»되고 켜지는 날 밀린 탈퇴가 그대로 전달된다.
                        OutboxDeliveryRequest.toRealtime(EVENT_USER_WITHDRAWN, null),
                        // 랭킹 적격성 계약(㊣)의 제외 사건 — 같은 USER 축에서 앞선 user.onboarded(SCORE)보다 뒤 version 이라
                        // SCORE transport 가 켜지는 날 밀린 편입 뒤에 이 제외가 따라 나간다(GROMO-1945).
                        OutboxDeliveryRequest.toScore())));
    }
}

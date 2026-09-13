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

/**
 * 탈퇴 사실을 위성으로 나르는 <b>내구 사건</b> (A22 ⓐ).
 *
 * <p>대상이 둘이다 — 알림은 Kafka 로 소비하고({@code user.withdrawn} + 멱등 삭제 + 새벽 리컨실),
 * 링크는 <b>Kafka 를 소비하지 않으므로</b>(계약 §2) 같은 사건이 HTTP 로도 나간다. 대상별 전달 상태가
 * 따로인 이유가 정확히 이것이다 — 하나로 합치면 한쪽만 실패했을 때 성공한 쪽까지 재전달되거나
 * 실패한 쪽이 영영 안 간다.
 *
 * <p><b>tombstone 은 이후 쓰기만 막는다.</b> 이미 박힌 귀속({@code claimed_user_id})은 탈퇴
 * 트랜잭션이 같은 커밋에서 끊어야 하고, 그 일은 {@code AccountWithdrawalService} 가 한다.
 */
@Service
@RequiredArgsConstructor
public class WithdrawalSatelliteCommandService {

    /** 사건 종류 — 계정이 탈퇴했다. */
    public static final String EVENT_USER_WITHDRAWN = "user.withdrawn";

    /** 링크 서버의 탈퇴 처리 논리 키. */
    public static final String ENDPOINT_USER_WITHDRAWN = "link.userWithdrawn";

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
                        // 링크 서버는 Kafka 에 붙지 않는다 — 같은 사건이 HTTP 로도 나간다.
                        OutboxDeliveryRequest.toLink(ENDPOINT_USER_WITHDRAWN, null))));
    }
}

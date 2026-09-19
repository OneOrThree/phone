package com.oneorthree.phone.user.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
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
 * 온보딩 완료 전이 사건 {@code user.onboarded} (㊣ 랭킹 적격성 계약 · 계정 LLD §2.3, GROMO-1945).
 *
 * <p>판정은 하지 않는다 — 호출부({@code UserService})가 잠금 안에서 변경 전·후 {@code OnboardingCompletion} 을 비교해
 * false→true 일 때만 부른다. 대상은 {@code score-events}(SCORE)이고 소비자가 생길 때까지 내구 보류된다.
 *
 * <p>{@code eventId} 는 사용자당 하나다({@code user.onboarded:<userId>}). 이름은 지울 수 없고 색은 null 로 되돌릴 수
 * 없어 완료 전이는 계정 수명에 한 번뿐이다 — 유일 인덱스가 그 가정을 지킨다.
 */
@Service
@RequiredArgsConstructor
public class UserOnboardingEvents {

    /** 사건 종류 — 온보딩을 마쳐 랭킹에 편입된다. */
    public static final String EVENT_USER_ONBOARDED = "user.onboarded";

    private static final int SCHEMA_VERSION = 1;

    private final OutboxCommandPort outboxCommandPort;

    /**
     * @param userId 온보딩을 마친 사용자
     * @return 적은 봉투 — 공개 명령 receipt 의 {@code events} 에 그대로 싣는다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public EventEnvelope recordOnboarded(UUID userId) {
        return outboxCommandPort.append(new OutboxAppendCommand(
                EVENT_USER_ONBOARDED + ":" + userId,
                SCHEMA_VERSION,
                EVENT_USER_ONBOARDED,
                userId,
                null,
                userId.toString(),
                AggregateRef.ofUser(userId),
                null,
                Map.of("userId", userId.toString()),
                List.of(OutboxDeliveryRequest.toScore())));
    }
}

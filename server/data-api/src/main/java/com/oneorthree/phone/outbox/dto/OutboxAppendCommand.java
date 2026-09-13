package com.oneorthree.phone.outbox.dto;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 봉투 하나를 적어 달라는 요구 — 도메인 서비스가 <b>자기 명령 트랜잭션 안에서</b> 넘긴다.
 *
 * <p>{@code version} 이 여기 없는 것은 의도다 — 발급은 outbox 가 aggregate 행 잠금 아래에서 한다(㊸).
 * 호출부가 번호를 만들어 넘길 수 있으면 그 잠금을 건너뛸 길이 열린다.
 *
 * <p>{@code occurredAt} 도 없다 — 사건 시각은 저장 시각과 같은 {@code Clock} 에서 나와야 순서
 * 축(version)과 어긋나지 않는다.
 *
 * @param eventId      결정적 사건 키. fan-out 은 수신자별로 펼친 뒤 {@code <사건키>:<userId>}(㊢)
 * @param schemaVersion 스키마 호환 버전 — 1 부터
 * @param type         사건 종류
 * @param userId       수신자 하나
 * @param locale       렌더 로케일. 미보고는 {@code null}
 * @param subjectId    사건 대상의 정규 식별자. 없으면 {@code null}
 * @param aggregate    순서 축 — 이 축의 행을 잠그고 version 을 발급한다
 * @param scheduledAt  예약 발송 시각. 즉시 사건은 {@code null}
 * @param params       사건별 발송 입력
 * @param deliveries   나가야 할 대상들. 비어 있으면 안 된다 — 아무 데도 안 가는 봉투는 유실과 같다
 */
public record OutboxAppendCommand(
        String eventId,
        int schemaVersion,
        String type,
        UUID userId,
        String locale,
        String subjectId,
        AggregateRef aggregate,
        Instant scheduledAt,
        Map<String, Object> params,
        List<OutboxDeliveryRequest> deliveries) {

    public OutboxAppendCommand {
        if (eventId == null || eventId.isBlank()) {
            throw new IllegalArgumentException("eventId 는 필수입니다 — 소비 측 dedup 의 유일한 근거다.");
        }
        if (schemaVersion < 1) {
            throw new IllegalArgumentException("schemaVersion 은 1 이상이어야 합니다.");
        }
        if (type == null || type.isBlank()) {
            throw new IllegalArgumentException("사건 종류는 필수입니다.");
        }
        if (userId == null) {
            throw new IllegalArgumentException("수신자는 필수입니다 — Kafka key 이기도 하다.");
        }
        if (aggregate == null) {
            throw new IllegalArgumentException("순서 축은 필수입니다.");
        }
        if (deliveries == null || deliveries.isEmpty()) {
            throw new IllegalArgumentException("전달 대상이 없는 봉투는 만들 수 없습니다 — 유실과 구분되지 않는다.");
        }
        deliveries = List.copyOf(deliveries);
        params = params == null
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(params));
    }
}

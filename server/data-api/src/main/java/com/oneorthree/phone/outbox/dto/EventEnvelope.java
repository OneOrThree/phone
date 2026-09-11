package com.oneorthree.phone.outbox.dto;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 정본 이벤트 봉투 (서비스 §「이벤트」 · A21 · A22 ㊸).
 *
 * <p>Data 의 명령 응답은 {@code eventId} 만이 아니라 <b>{@code version} 을 포함한 완성된 봉투</b>를
 * 돌려준다(㉵) — Business 는 DB 가 없어 레코드를 다시 읽을 수 없으므로, {@code eventId} 만 받으면
 * 요청형 이벤트의 정본 봉투를 구성할 수 없다(필수 필드가 빈다).
 *
 * <p>{@code schemaVersion} 과 {@code version} 은 <b>다른 값이며 둘 다 필수</b>다. 전자는 스키마
 * 호환(expand/contract)용이고 후자는 소비자가 투영별 역순 적용을 거부하는 데 쓴다.
 *
 * @param eventId       결정적 사건 키 — 소비 측 dedup 의 유일한 근거. fan-out 은 {@code <사건키>:<userId>}
 * @param schemaVersion 스키마 호환 버전(ⓦ)
 * @param type          사건 종류
 * @param occurredAt    사건 발생 시각
 * @param scheduledAt   예약 발송 시각 — 즉시 사건은 {@code null}
 * @param userId        수신자 하나. fan-out 은 이미 펼쳐진 뒤다(㊢)
 * @param locale        렌더 로케일 — 미보고는 {@code null}, 수신 측이 ko 폴백
 * @param subjectId     사건 대상의 정규 식별자 — 컬렉션 투영은 {@code (userId, subjectId)} 별 최대
 *                      version 으로 역순을 막는다. 대상이 없으면 {@code null}
 * @param version       aggregate 행 잠금 아래 발급된 단조 증가 값(㊸)
 * @param params        사건별 발송 입력 — 소비자는 모르는 필드를 무시한다
 */
public record EventEnvelope(
        String eventId,
        int schemaVersion,
        String type,
        Instant occurredAt,
        Instant scheduledAt,
        UUID userId,
        String locale,
        String subjectId,
        long version,
        Map<String, Object> params) {

    public EventEnvelope {
        // Map.copyOf 를 쓰지 않는다 — 그쪽은 순서를 버리고 «null 값»을 거부한다. params 는 사건별
        // 자유 입력이라 nullable 필드가 정상적으로 들어오고, 그때 봉투 생성이 NPE 로 죽으면 원인이
        // 명령 저장부에서 한참 떨어진 자리에 드러난다.
        params = params == null
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(params));
    }
}

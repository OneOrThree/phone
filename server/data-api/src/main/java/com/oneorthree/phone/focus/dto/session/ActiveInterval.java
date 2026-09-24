package com.oneorthree.phone.focus.dto.session;

import java.time.Instant;

/**
 * ACTIVE 구간 하나의 공개 표현 (GROMO-2131) — {@link FocusSessionView}·{@link FocusFinishView} 가
 * 공유한다. REST 구간은 나오지 않는다.
 *
 * @param startedAt 구간 시작
 * @param endedAt   구간 끝 — session view 의 열린 구간은 그 응답의 {@code serverNow} 로 임시로 닫는다
 *                  (그래서 구간 길이 합은 {@code activeSeconds} 와 일치한다, 서브초 절삭은 예외).
 *                  finish view 는 이미 전부 닫힌 뒤라 늘 값이 있다
 */
public record ActiveInterval(Instant startedAt, Instant endedAt) {
}

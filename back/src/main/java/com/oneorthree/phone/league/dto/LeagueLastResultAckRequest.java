package com.oneorthree.phone.league.dto;

import java.time.Instant;

/**
 * 주간 리그 마감 결과 확인(ack) 요청 (GROMO-567).
 *
 * <p>클라가 {@code GET /last-result} 로 받은 결과의 {@code weekStartAt} 을 그대로 실어 보낸다.
 * 서버는 ack 시점에 최신행을 다시 조회하지 않고 이 주차를 대상으로 확인 처리하므로, 그 사이 주간 배치가
 * 새 주차 결과를 넣더라도 유저가 실제로 본 결과만 확인되고 미노출 결과가 삼켜지지 않는다.
 *
 * @param weekStartAt 확인 처리할 결과의 주차 시작 시각
 */
public record LeagueLastResultAckRequest(Instant weekStartAt) {
}

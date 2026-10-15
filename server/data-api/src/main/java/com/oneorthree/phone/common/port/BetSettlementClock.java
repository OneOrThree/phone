package com.oneorthree.phone.common.port;

import java.time.Instant;
import java.util.UUID;

/** 정산 커밋과 결과 알림 슬롯 마감을 직렬화한 뒤 종료 시각을 발급한다. */
public interface BetSettlementClock {

    Instant settlementTime(UUID groupId);
}

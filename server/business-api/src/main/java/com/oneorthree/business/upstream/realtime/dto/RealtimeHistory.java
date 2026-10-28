package com.oneorthree.business.upstream.realtime.dto;

import java.util.List;
import java.util.UUID;

/**
 * 실시간 서버의 히스토리 한 페이지 — <b>최신 → 과거</b>. 공개 응답은 뒤집어 오름차순으로 낸다.
 *
 * @param messages   최신부터. 한 페이지의 실제 반환분(limit+1 판정용 초과행은 이미 잘려 있다)
 * @param nextCursor 다음 «과거» 페이지의 anchor = 이 페이지의 가장 오래된 id. 더 없으면 null
 * @param hasMore    {@code nextCursor != null} 과 같은 뜻
 */
public record RealtimeHistory(List<RealtimeMessage> messages, UUID nextCursor, boolean hasMore) {
}

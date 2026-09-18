package com.oneorthree.business.upstream.realtime;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.realtime.dto.RealtimeHistory;
import com.oneorthree.business.upstream.realtime.dto.RealtimeStoreResult;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.Map;
import java.util.UUID;

/**
 * 실시간 서버({@code gromo_chat} 소유)로 나가는 유일한 창구 — 우체통 편지방의 저장소 어댑터 (GROMO-1775,
 * island-mailbox LLD §3). 경로가 여기 상수로만 있으므로 임의 URL 프록시가 불가능하다.
 *
 * <p>자격은 {@code SVC_TOKEN_BIZ_TO_REALTIME} 하나 — Data·알림·링크 토큰과 «분리»다(A22 ㊀). 주체는
 * {@code X-User-Id} 로 위임하며 앱 AT 는 넘기지 않는다. 인가(주민·시설)는 <b>이 호출 전에</b> Data 로 끝낸다 —
 * 실시간 서버의 내부 어댑터는 인가를 하지 않는다.
 *
 * <p>wire 는 실시간 서버의 legacy DTO 이름({@code messageId/senderId/content/sentAt})이다. 공개 이름으로의
 * 변환은 {@code IslandMailboxUseCase} 가 한다.
 */
public class RealtimeApiClient {

    private static final String PATH_MESSAGES = "/internal/islands/{islandId}/messages";

    private final InternalHttpClient http;

    public RealtimeApiClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 최신 → 과거 한 페이지. {@code cursor} 는 저장소 의미의 id(이보다 과거)이고 {@code limit} 은 1~100 —
     * 둘 다 서명 커서를 푼 뒤의 값이다. 멱등 GET 이라 재시도한다.
     */
    public RealtimeHistory history(UUID islandId, UUID userId, UUID cursor, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, path(islandId))
                        .onBehalfOf(userId)
                        .query("cursor", cursor == null ? null : cursor.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<RealtimeHistory>() { });
    }

    /**
     * 저장. <b>멱등이 보장된 명령이라 재시도한다</b> — 같은 {@code clientMessageId} 는 DB 유니크 제약이 같은 행으로
     * 접고, 응답 유실 뒤 재시도는 처음 저장된 그 메시지를 돌려받는다(같은 키·다른 본문만 409 다).
     */
    public RealtimeStoreResult store(UUID islandId, UUID userId, UUID clientMessageId, String text, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, path(islandId))
                        .onBehalfOf(userId)
                        .body(Map.of("content", text, "clientMessageId", clientMessageId.toString()))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<RealtimeStoreResult>() { });
    }

    private static String path(UUID islandId) {
        return PATH_MESSAGES.replace("{islandId}", islandId.toString());
    }
}

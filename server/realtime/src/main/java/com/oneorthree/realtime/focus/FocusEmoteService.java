package com.oneorthree.realtime.focus;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.event.EventRouter;
import com.oneorthree.realtime.event.FocusEmoteType;
import com.oneorthree.realtime.event.RealtimeAudience;
import com.oneorthree.realtime.event.RealtimeEventEnvelope;
import com.oneorthree.realtime.event.RealtimeEventType;
import com.oneorthree.realtime.focus.dto.FocusEmoteRequest;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * 응원 한 건을 그 섬에 방송한다 — {@code /app/islands/{islandId}/focus/emotes} 의 도메인 (GROMO-1765).
 *
 * <h2>서버가 만드는 값과 클라이언트가 주는 값</h2>
 * 클라이언트가 주는 것은 {@code sessionId}·{@code type} 둘뿐이다(focus-rest-session LLD §2).
 * {@code userId}·{@code eventId}·{@code occurredAt}·{@code expiresAt}·목적지는 <b>전부 서버가 만든다</b> —
 * 받는 순간 남의 이름으로, 남의 화면에, 원하는 만큼 오래 남는 말풍선을 꽂는 요청이 형식상 정상이 된다.
 *
 * <h2>TTL 3초 — 문서의 「목업3초를 기본값으로 넣지 않는다」를 뒤집는다</h2>
 * realtime-events PRD 의 「양의 TTL·빈도 제한을 1765에서 확정한 후 활성화한다」를 이 클래스가 이행한다.
 * 값은 앱 목업과 같은 3초다({@code Screens.tsx} 의 {@code setTimeout(…, 3000)}). 3초를 고른 이유는
 * <b>다른 값을 고를 근거가 없기 때문</b>이다 — 유일하게 존재하는 실측은 그 목업이고, 앱이 이미 그 길이로
 * 사라지게 그려 둔 상태에서 서버가 다른 수를 주면 두 값 중 짧은 쪽이 이겨 서버 TTL 이 무의미해진다.
 * FR-D05 가 다른 값을 정하면 {@code realtime.focus.emote-ttl} 한 곳만 바꾼다.
 *
 * <h2>빈도 제한이 둘인 이유 — 「거절도 비용을 치른다」</h2>
 * <ul>
 *   <li><b>시도 창</b> {@code lock:chat:emote:try:{userId}} — <b>사용자당</b> 600ms 에 1회.
 *       <b>{@code StompAuthChannelInterceptor} 가</b> 본문 변환보다 먼저 잡는다(이 클래스가 아니다).
 *       그래야 {@code sessionId} 가 빠진 프레임처럼 <b>변환 단계에서 죽는 요청</b>도 창을 소모한다 —
 *       이 메서드까지 오지 못하는 거절이 유일하게 공짜였던 구멍을 그렇게 막았다.</li>
 *   <li><b>성공 창</b> {@code lock:chat:emote:{islandId}:{userId}} — 섬마다 TTL 과 같은 3초에 1건.
 *       <b>인가를 통과한 뒤에만</b> 잡는다. 사용자에게 보이는 「너무 자주」는 이쪽이다.</li>
 * </ul>
 *
 * <p>하나로 합치면 둘 중 하나가 깨진다. 성공 창 하나만 두고 인가를 먼저 하면 <b>임의의 다른 섬 UUID</b>
 * 로 보내는 거절 요청이 제한 키를 만들지도 않은 채 <b>매번 Data 정본 조회를 부른다</b> — 인증된 사용자
 * 하나가 여러 연결에서 SEND 를 반복하면 동기 HTTP 로 STOMP 채널 스레드와 Data API 를 고갈시킬 수 있다
 * (섬이 키에 있으면 UUID 만 바꿔 제한을 비켜 간다 — 그래서 시도 창은 <b>사용자 축</b>이다). 반대로
 * 시도 창 하나만 두고 성공까지 거기서 재면 잘못된 type 한 번이 정상 응원의 창을 먹는다.
 *
 * <p>그래서 <b>상류 호출의 상한은 시도 창</b>이다 — 사용자당 600ms 에 {@code requireActiveSession}
 * 한 번. 성공 창(3초)이 아니라 이쪽이 그 상한을 정의한다.
 *
 * <p>두 창 모두 세지 않고 {@code SET key value NX PX} <b>한 명령</b>으로 «있으면 거절»한다. INCR 로 세면
 * 수명을 거는 EXPIRE 가 별도 명령이라 그 사이에 끊기면 수명 없는 카운터가 남아 <b>그 사람이 영영 응원을
 * 못 보낸다</b> — {@code MembershipService} 가 SET 대신 문자열 하나를 쓰는 것과 같은 이유다.
 *
 * <p>순서: <b>시도 창(관문) → 형식 → 인가 → 성공 창</b>.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FocusEmoteService {

    private final IslandFocusSessions focusSessions;
    private final EventRouter eventRouter;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    @Value("${realtime.focus.emote-ttl:3s}")
    private Duration emoteTtl;

    public void publish(UUID islandId, UUID userId, FocusEmoteRequest request) {
        // 시도 창은 이 메서드에 «들어오기 전»에 이미 소모됐다({@code StompAuthChannelInterceptor}).
        // 여기서 또 재면 한 프레임이 창을 두 번 먹어, 두 번째 정상 응원이 자기 자신 때문에 막힌다.
        FocusEmoteType type = FocusEmoteType.of(request.type())
                .orElseThrow(() -> new ChatException(ChatErrorCode.INVALID_EMOTE_TYPE));
        // 같은 조회가 발신 인가와 «수신 자격»을 함께 준다 — 전달 직전 판정이 구독자마다 다시 묻지
        // 않아도 되는 이유다(LLD §4.2 배치 권한조회).
        Set<UUID> recipients = focusSessions.requireActiveSession(islandId, userId, request.sessionId());
        if (!acquire(RedisKeys.emoteRateLimit(islandId, userId), emoteTtl)) {
            throw new ChatException(ChatErrorCode.EMOTE_TOO_FREQUENT);
        }

        Instant now = clock.instant();
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("userId", userId.toString());
        payload.put("sessionId", request.sessionId().toString());
        payload.put("type", type.wireName());
        payload.put("expiresAt", now.plus(emoteTtl).toString());

        // aggregateVersion 은 null 이다 — 응원은 «상태»가 아니라 «순간»이라 병합할 투영 버전이 없다
        // (RealtimeEventEnvelope 가 FOCUS_EMOTE 에 한해 null 을 강제한다).
        eventRouter.route(new RealtimeEventEnvelope(UUID.randomUUID(), RealtimeEventType.FOCUS_EMOTE,
                islandId, null, now, payload), new RealtimeAudience.IslandAudience(islandId, recipients));
    }

    /**
     * 창 하나를 선점한다 — {@code SET key 1 NX PX ttl} 한 명령.
     *
     * <p>Redis 가 답하지 않으면 <b>통과시킨다</b>. 빈도 제한은 남을 막는 규칙이 아니라 화면과 상류를
     * 아끼는 규칙이라, Redis 장애 때 「응원 전면 차단」으로 번지는 쪽이 더 나쁘다 — 인가 자체는
     * {@code IslandFocusSessions} 가 fail-closed 로 따로 지킨다. 다만 <b>그 장애 동안에는 상류 호출의
     * 상한도 함께 사라진다</b>: Redis 가 죽으면 팬아웃·멤버십·프레즌스도 같이 죽어 이 서비스가 어차피
     * 정상 동작하지 않으므로, 여기서만 fail-closed 로 가도 얻는 것이 없다.
     */
    private boolean acquire(String key, Duration window) {
        try {
            return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key, "1", window));
        } catch (RuntimeException e) {
            log.warn("응원 빈도 제한 조회 실패 — 이번 건은 통과시킨다", e);
            return true;
        }
    }
}

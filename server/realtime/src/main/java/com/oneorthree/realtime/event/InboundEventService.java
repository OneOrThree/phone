package com.oneorthree.realtime.event;

import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.membership.MembershipService;
import com.oneorthree.realtime.message.service.ChatUserFence;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Data outbox 사건의 <b>단일 처리기</b> — HTTP({@code POST /internal/events})와 Kafka({@code realtime-events})
 * 두 입구가 여기로 모인다 (GROMO-1954, 2026-09-19 R-1). 알림 서버 {@code InboundService} 와 같은 구조다.
 *
 * <h2>eventId 로 한 번만 적용한다</h2>
 * 수신 기록({@code inbound_events})을 <b>먼저</b> 넣고 같은 트랜잭션에서 적용한다. 이미 있으면 적용하지 않고
 * 성공으로 돌려준다 — relay 재전달·두 입구 중복·동시 도착이 모두 여기서 접힌다(동시 둘은 PK 에서 뒤의 것이
 * 앞의 커밋을 기다린 뒤 충돌로 끝난다). 적용이 실패하면 기록도 함께 롤백돼 재전달이 다시 적용한다.
 * ponytail: 수신 기록은 지우지 않는다 — 보존 기간은 A18(재시도 기간)이 정해지면 그만큼만 두고 지운다.
 *
 * <h2>무엇을 적용하는가</h2>
 * <ul>
 *   <li>{@code user.withdrawn} — {@link ChatUserFence#withdraw}(tombstone + 커서 파기).</li>
 *   <li>{@code focus.member.updated}·{@code rest.member.updated} — 7필드 봉투로 바꿔 {@link EventRouter} 로
 *       섬 토픽에 전달한다(GROMO-1765). 이 둘만 여는 조건은 아래에 적었다.</li>
 *   <li>{@code island.members.updated} 의 MEMBER_ADDED·MEMBER_REMOVED — {@code params.memberUserId} 가 있으면
 *       {@link MembershipService#evict} 로 그 유저의 채팅 멤버십 캐시를 즉시 지운다(GROMO-2140). 앱 전달(아래
 *       항목)과는 <b>별개의 부수 효과</b>다 — 이 type 은 아직 STOMP 로 나가지 않지만 캐시 무효화는 그와 무관하게
 *       적용한다. 옛 Data 가 보낸 필드 없는 사건은 조용히 건너뛴다 — TTL 이 그대로 백스톱이다.</li>
 *   <li>나머지 앱 사건 — <b>받아서 중복만 거르고 앱으로 내보내지 않는다.</b> 여기서 거절하면 relay 가
 *       permanent 로 적고 그 순서 축이 영영 막히므로(A18 고갈 처리 없음) 형식이 달라도 받는다 —
 *       옛 7필드 외양 행({@code islandId}·{@code aggregateVersion}·{@code payload})도 {@code eventId}·
 *       {@code type} 만 보면 같은 길로 소비된다.</li>
 *   <li>그 밖의 type — 400. 계약 밖의 사건을 조용히 삼키지 않는다.</li>
 * </ul>
 *
 * <h2>왜 주민 사건 둘만 여는가</h2>
 * 종전 주석이 전달을 닫아 둔 조건은 세 가지였고, 그 셋이 이제 둘에 대해서만 충족됐다.
 * <ol>
 *   <li><b>구독 인가</b> — {@code StompAuthChannelInterceptor} 가 {@code /topic/islands/{id}/focus|rest|emotes}
 *       를 허용목록에 넣고, {@code ChatOutboundChannelInterceptor} 가 무조건 차단을 풀었다.</li>
 *   <li><b>권한 회수</b> — 이 두 사건의 수신 자격은 「인증된 사용자」다(비소속 관전 개방, 2026-09-19).
 *       회수할 권한이 없으므로 회수 배선도 필요 없다. 관전이 아닌 {@code emotes} 는 구독·발신마다
 *       Data 정본({@code IslandFocusSessions})을 다시 보고, 전달 직전에 프레즌스를 다시 본다.</li>
 *   <li><b>재연결 복구</b> — 앱이 스냅샷({@code GET /islands/{id}/focus-members}) 과 함께 받는
 *       {@code watermarks} 로 병합한다(realtime-events LLD §5). 이 봉투의 {@code aggregateVersion} 이
 *       그 watermark 와 같은 축(outbox aggregate version)이라 비교가 성립한다.</li>
 * </ol>
 * 나머지 11종은 셋 중 하나 이상이 아직 없다 — 특히 도메인 payload validator 가 없는 type 은 활성화하지
 * 않는다(realtime-events LLD §8 「validator 없는 타입의 활성화 금지」).
 *
 * <h2>변환·계약 검증 실패를 400 으로 올리지 않는다</h2>
 * {@code eventId} 가 UUID 가 아니거나, {@code schemaVersion} 이 1 이 아니거나, payload 가 그 type 의
 * 계약({@link EventPayloadValidator})을 어기면 봉투를 만들 수 없다. 그때도 200 으로 받고
 * <b>전달만 건너뛴다</b> — 400 은 relay 가 permanent 로 적어 그 순서 축을 영영 막고, 그 대가가
 * 「실시간 갱신 한 건 유실」보다 훨씬 크기 때문이다. 앱은 스냅샷 재조회로 복구한다.
 *
 * <p>그래서 <b>서비스 토큰이 내용을 보증하지 않는다</b>는 점이 중요하다 — 토큰은 「Data 가 보냈다」만
 * 증명한다. 검증을 생략하면 필드가 빠졌거나 상태값이 계약 밖인 사건이 <b>유효한 봉투로</b> 방송된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InboundEventService {

    static final String USER_WITHDRAWN = "user.withdrawn";

    private static final Set<String> APP_EVENT_TYPES = Arrays.stream(RealtimeEventType.values())
            .map(RealtimeEventType::wireName)
            .collect(Collectors.toUnmodifiableSet());

    private static final Set<String> DELIVERED_TYPES = Set.of(
            RealtimeEventType.FOCUS_MEMBER_UPDATED.wireName(), RealtimeEventType.REST_MEMBER_UPDATED.wireName());

    /** 주민 «집합»이 실제로 바뀌는 changeKind 만 — HOST_TRANSFER 는 무효화할 멤버십이 없다. */
    private static final Set<String> MEMBERSHIP_CHANGE_KINDS = Set.of("MEMBER_ADDED", "MEMBER_REMOVED");

    private final JdbcTemplate jdbc;
    private final ChatUserFence chatUserFence;
    private final EventRouter eventRouter;
    private final MembershipService membershipService;

    /**
     * 사건 하나를 처리한다 — 두 입구 공통.
     *
     * @param envelope Data outbox 정본 봉투
     * @return 이번에 처음 적용했으면 {@code true}, 이미 받은 사건이면 {@code false}
     * @throws InvalidEventException 계약 밖의 사건·형식 오류
     */
    @Transactional
    public boolean accept(JsonNode envelope) {
        String eventId = requiredText(envelope, "eventId");
        String type = requiredText(envelope, "type");
        if (!USER_WITHDRAWN.equals(type) && !APP_EVENT_TYPES.contains(type)) {
            throw new InvalidEventException();
        }
        int inserted = jdbc.update("INSERT INTO inbound_events (event_id, type) VALUES (?, ?)"
                + " ON CONFLICT (event_id) DO NOTHING", eventId, type);
        if (inserted == 0) {
            log.debug("이미 받은 사건 — eventId={} type={}", eventId, type);
            return false;
        }
        if (USER_WITHDRAWN.equals(type)) {
            chatUserFence.withdraw(uuid(envelope, "userId"), authGeneration(envelope));
        } else {
            evictMembershipCacheIfNeeded(type, envelope);
            deliver(eventId, type, envelope);
        }
        return true;
    }

    /**
     * 강퇴·탈퇴·재가입의 즉시 캐시 무효화(GROMO-2140) — {@code island.members.updated} 의 MEMBER_ADDED·
     * MEMBER_REMOVED 만 본다. STOMP 전달({@link #deliver})과 무관한 부수 효과라 이 type 이
     * {@link #DELIVERED_TYPES} 밖이어도 그대로 적용한다.
     */
    private void evictMembershipCacheIfNeeded(String type, JsonNode envelope) {
        if (!RealtimeEventType.ISLAND_MEMBERS_UPDATED.wireName().equals(type)) {
            return;
        }
        JsonNode params = envelope.get("params");
        if (params == null || !params.isObject()) {
            return;
        }
        JsonNode changeKind = params.get("changeKind");
        boolean membershipChanged = changeKind != null && changeKind.isString()
                && MEMBERSHIP_CHANGE_KINDS.contains(changeKind.stringValue());
        if (!membershipChanged) {
            return;
        }
        JsonNode memberUserId = params.get("memberUserId");
        if (memberUserId == null || !memberUserId.isString()) {
            log.debug("주민 사건에 memberUserId 가 없다 — 옛 Data. TTL 로만 무효화한다.");
            return;
        }
        try {
            membershipService.evict(UUID.fromString(memberUserId.stringValue()));
        } catch (IllegalArgumentException e) {
            log.warn("memberUserId 가 UUID 형식이 아닙니다 — 무효화를 건너뜁니다.");
        }
    }

    /** 전달 어댑터가 있는 사건만 7필드로 바꿔 섬 토픽으로 보낸다. 나머지는 기록만 하고 끝낸다. */
    private void deliver(String eventId, String type, JsonNode envelope) {
        if (!DELIVERED_TYPES.contains(type)) {
            log.debug("앱 사건 수신 — 이 type 의 전달 어댑터가 아직 없다. eventId={} type={}", eventId, type);
            return;
        }
        RealtimeEventEnvelope event;
        try {
            event = memberEvent(eventId, type, envelope);
        } catch (RuntimeException e) {
            // 봉투 본문은 로그에 남기지 않는다(realtime-events LLD §6).
            log.error("주민 사건 변환 실패 — 전달하지 않는다. eventId={} type={} reason={}",
                    eventId, type, e.getClass().getSimpleName());
            return;
        }
        eventRouter.route(event, new RealtimeAudience.IslandAudience(event.islandId()));
    }

    /**
     * Data outbox 정본 10필드 → 앱이 받는 7필드.
     *
     * <p>축 대응이 이 메서드의 전부다: {@code subjectId} 가 섬이고({@code FocusMemberEvents#append} 가
     * {@code islandId} 를 싣는다), {@code version} 이 {@code (섬, 사용자)} 축의 aggregate version 이라
     * 스냅샷 watermark 와 같은 수직선 위에 있다. {@code params} 를 그대로 payload 로 쓴다 — 여기서
     * 필드를 고르면 생산자가 필드를 늘릴 때마다 이 파일이 같이 바뀌어야 한다. 대신 <b>계약 검증은
     * {@link EventPayloadValidator} 가</b> 봉투 생성 중에 한다(활성 3종은 도메인 필드까지 본다).
     *
     * <p><b>{@code schemaVersion} 을 원본에서 읽는다.</b> 기본값 1 생성자를 쓰면 생산자가 보낸 schema 2
     * 사건이 <b>「schema 1」이라고 적힌 채</b> 앱에 도착한다 — 앱은 그 표시를 믿고 1 의 규칙으로 읽으므로,
     * 모르는 스키마를 만났을 때 하라던 일(무시·재조회)을 할 기회를 잃는다. 7인자 정본 생성자가 1 이
     * 아닌 값을 거절하고, 그 거절은 {@code deliver} 에서 「전달 안 함 + 200」이 된다.
     */
    private static RealtimeEventEnvelope memberEvent(String eventId, String type, JsonNode envelope) {
        RealtimeEventType eventType = RealtimeEventType.FOCUS_MEMBER_UPDATED.wireName().equals(type)
                ? RealtimeEventType.FOCUS_MEMBER_UPDATED : RealtimeEventType.REST_MEMBER_UPDATED;
        JsonNode params = envelope.get("params");
        if (params == null || !params.isObject()) {
            throw new IllegalArgumentException("주민 사건 params 가 객체가 아닙니다.");
        }
        return new RealtimeEventEnvelope(UUID.fromString(eventId), intValue(envelope, "schemaVersion"), eventType,
                UUID.fromString(requiredText(envelope, "subjectId")), longValue(envelope, "version"),
                Instant.parse(requiredText(envelope, "occurredAt")), params);
    }

    private static int intValue(JsonNode envelope, String field) {
        JsonNode value = envelope.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt()) {
            throw new IllegalArgumentException("봉투 정수 필드가 올바르지 않습니다.");
        }
        return value.intValue();
    }

    private static long longValue(JsonNode envelope, String field) {
        JsonNode value = envelope.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()) {
            throw new IllegalArgumentException("봉투 정수 필드가 올바르지 않습니다.");
        }
        return value.longValue();
    }

    private static String requiredText(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isString() || value.stringValue().isBlank()) {
            throw new InvalidEventException();
        }
        return value.stringValue();
    }

    private static UUID uuid(JsonNode node, String field) {
        try {
            return UUID.fromString(requiredText(node, field));
        } catch (IllegalArgumentException e) {
            throw new InvalidEventException();
        }
    }

    private static long authGeneration(JsonNode envelope) {
        JsonNode params = envelope.get("params");
        JsonNode value = params == null ? null : params.get("authGeneration");
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 0) {
            throw new InvalidEventException();
        }
        return value.longValue();
    }

    /** 계약 밖의 사건·형식 오류 — HTTP 는 400, Kafka 는 재시도 뒤 {@code .DLT}. */
    public static class InvalidEventException extends DomainException {
        InvalidEventException() {
            super(CommonErrorCode.INVALID_REQUEST);
        }
    }
}

package com.oneorthree.realtime.event;

import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.message.service.ChatUserFence;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

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
 *   <li>앱 사건 14종({@link RealtimeEventType}) — <b>받아서 중복만 거르고 앱으로 내보내지 않는다.</b>
 *       STOMP 구독 허용목록이 섬 목적지({@code /topic/islands/**})·{@code /user/queue/events} 를 아직 열지
 *       않는다({@code StompAuthChannelInterceptor}) — 섬 구독 인가·권한 회수·재연결 복구가 먼저다. 그래서
 *       7필드 변환과 {@link EventRouter} 호출도 그때 붙인다. 여기서 거절하면 relay 가 permanent 로 적고
 *       그 순서 축이 영영 막히므로(A18 고갈 처리 없음) 형식이 달라도 받는다 — 옛 7필드 외양 행
 *       ({@code islandId}·{@code aggregateVersion}·{@code payload})도 {@code eventId}·{@code type} 만 보면
 *       같은 길로 소비된다.</li>
 *   <li>그 밖의 type — 400. 계약 밖의 사건을 조용히 삼키지 않는다.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InboundEventService {

    static final String USER_WITHDRAWN = "user.withdrawn";

    private static final Set<String> APP_EVENT_TYPES = Arrays.stream(RealtimeEventType.values())
            .map(RealtimeEventType::wireName)
            .collect(Collectors.toUnmodifiableSet());

    private final JdbcTemplate jdbc;
    private final ChatUserFence chatUserFence;

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
            log.debug("앱 사건 수신 — 섬 구독 인가 전이라 전달하지 않는다. eventId={} type={}", eventId, type);
        }
        return true;
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

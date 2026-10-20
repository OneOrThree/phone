package com.oneorthree.realtime.event;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.config.OutboundAuthzCache;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.membership.CurrentMembershipDecisionCache;
import com.oneorthree.realtime.membership.MembershipService;
import com.oneorthree.realtime.message.service.ChatUserFence;
import com.oneorthree.realtime.movement.stomp.MovementSubscriptionListener;
import com.oneorthree.realtime.sea.SeaRooms;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.socket.CloseStatus;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
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
 *   <li>{@code user.withdrawn} — {@link ChatUserFence#withdraw}(tombstone + 커서 파기), 그리고 바다 방 퇴장
 *       ({@link SeaRooms#leaveCurrent}, {@code sea.member.left{reason:left}}). 탈퇴는 Data 가 세션을 벌크 UPDATE 로
 *       끝내 {@code sea.member.updated(ended)} 가 오지 않으므로 여기서 치운다(GROMO-2300).</li>
 *   <li>{@code focus.member.updated}·{@code rest.member.updated} — 7필드 봉투로 바꿔 {@link EventRouter} 로
 *       섬 토픽에 전달한다(GROMO-1765). 이 둘만 여는 조건은 아래에 적었다.</li>
 *   <li>{@code island.members.updated} 의 MEMBER_ADDED·MEMBER_REMOVED — {@code params.memberUserId} 가 있으면
 *       {@link MembershipService#evict} 로 그 유저의 채팅 멤버십 캐시를 즉시 지운다(GROMO-2140). 앱 전달(아래
 *       항목)과는 <b>별개의 부수 효과</b>다 — 이 type 은 아직 STOMP 로 나가지 않지만 캐시 무효화는 그와 무관하게
 *       적용한다. 옛 Data 가 보낸 필드 없는 사건은 조용히 건너뛴다 — TTL 이 그대로 백스톱이다. MEMBER_REMOVED 는
 *       커밋 뒤 그 섬 이동 방의 멤버십도 다시 본다({@link MovementSubscriptionListener#recheckMembership},
 *       GROMO-2247 N7).</li>
 *   <li>{@code user.blocks.updated} — 앱 사건이 아닌 <b>내부 제어 사건</b>이다(GROMO-2182). Data 가 차단·해제
 *       트랜잭션 안에서 적고, 여기서 {@code params.blockerUserId} 의 차단 세대를 {@link BlockedUsers#advanceGeneration}
 *       으로 올린다 — 그 순간부터 그 사람의 캐시된 차단 집합은 읽히지 않고, 다음 전달 판정이 Data 정본을 다시
 *       읽는다. 세대 올리기가 실패하면 예외를 올려 수신 기록까지 롤백한다(relay 가 다시 보낸다). 필드가 없으면
 *       건너뛴다 — TTL 이 백스톱이다.</li>
 *   <li>{@code sea.member.updated} — 이것도 <b>내부 제어 사건</b>이다(GROMO-2300, N19). 섬 변환을 타지 않고
 *       {@link SeaRooms#applyMemberUpdated} 가 그 사용자의 바다 방 상태를 고쳐 방 토픽으로 중계한다. params 가 불량이거나
 *       바다 방에 없는 사용자면 200 으로 받고 끝낸다 — USER 축은 {@code user.withdrawn} 과 같은 축이라 400 한 번이
 *       탈퇴 전파까지 막는다. Redis 쓰기 실패만 예외로 올려 수신 기록을 롤백한다.</li>
 *   <li>나머지 앱 사건 — <b>받아서 중복만 거르고 앱으로 내보내지 않는다.</b> 여기서 거절하면 relay 가
 *       permanent 로 적고 그 순서 축이 영영 막히므로(A18 고갈 처리 없음) 형식이 달라도 받는다 —
 *       옛 7필드 외양 행({@code islandId}·{@code aggregateVersion}·{@code payload})도 {@code eventId}·
 *       {@code type} 만 보면 같은 길로 소비된다.</li>
 *   <li>그 밖의 type — 400. 계약 밖의 사건을 조용히 삼키지 않는다.</li>
 * </ul>
 * 셋(탈퇴·차단·멤버십 변경)은 원 캐시를 고친 <b>뒤에</b> 전달 직전 인가 결정 캐시({@link OutboundAuthzCache})에서 그 사용자를
 * 지운다(GROMO-2340) — 먼저 지우면 그 사이의 판정이 아직 옛 Redis 값으로 허용을 다시 담는다.
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
 * {@code island.member.arrived}(GROMO-2302)도 세 조건을 채워 연다 — 구독은 현재 소속 주민만(Data 정본 확인), 회수는
 * 전달 직전 프레임마다 캐시 멤버십 재검사(MEMBER_REMOVED 가 지우고 TTL 이 상한), 재연결 복구는 필요 없다(일회성 소식 —
 * 놓치면 토스트 한 번이 안 뜰 뿐이다). payload 는 전용 변환({@link #arrivalEvent})이 고른 필드만 싣는다.
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

    /** 차단 관계 변경 — 앱으로 나가지 않는 내부 제어 사건(GROMO-2182). Data {@code UserBlockEvents.EVENT_TYPE}. */
    static final String USER_BLOCKS_UPDATED = "user.blocks.updated";

    /** 바다 상태 변경 — 내부 제어 사건(GROMO-2300). Data 바다 세션 start·finish·한마디 변경이 적는다. */
    static final String SEA_MEMBER_UPDATED = "sea.member.updated";

    /**
     * 로그인 세션 폐기 — 내부 제어 사건(GROMO-2350). Data {@code AuthSessionService.EVENT_SESSION_REVOKED}.
     * 기본 OFF 모드는 전달 직전 인가가 AT 의 sid 를 보지 않아 폐기된 세션의 AT 가 만료까지 통과하므로, 캐시 삭제만으로는
     * 부족하고 그 sid 의 STOMP 연결을 닫는 것이 수정이다.
     */

    static final String AUTH_SESSION_REVOKED = "auth.session.revoked";

    /**
     * 폐기 펜스 수명 — 폐기 sid 로 이미 발급된 AT 의 최대 수명. realtime 은 AT 수명 설정을 갖지 않고, 소켓의 bearer 는 앱이 재발급한
     * 더 늦은 AT 보다 일찍 만료할 수 있어(세션이 없을 때는 알 수도 없다) 그 exp 를 믿을 수 없다. Data 의 가장 긴 값(dev
     * {@code jwt.access-expiration} 2592000s = 30일, prod 3600s)을 쓴다.
     * ponytail: prod 에는 과하다(폐기 건수 × 30일치 항목, 건당 ~100 B). 커지면 AT 수명을 설정으로 받아 줄인다.
     */
    private static final Duration MAX_ACCESS_TOKEN_LIFETIME = Duration.ofDays(30);

    private static final Set<String> APP_EVENT_TYPES = Arrays.stream(RealtimeEventType.values())
            .map(RealtimeEventType::wireName)
            .collect(Collectors.toUnmodifiableSet());

    private static final Set<String> DELIVERED_TYPES = Set.of(
            RealtimeEventType.FOCUS_MEMBER_UPDATED.wireName(), RealtimeEventType.REST_MEMBER_UPDATED.wireName(),
            RealtimeEventType.ISLAND_MEMBER_ARRIVED.wireName());

    /** {@code island.member.arrived} 가 앱으로 내보내는 필드 — 그 밖은 버린다(주민 전용 채널이라도 고른 것만). */
    private static final List<String> ARRIVAL_FIELDS = List.of("islandId", "userId", "name", "catColor", "arrivedAt");

    /** 소속이 «줄어드는» changeKind — 이동 방 재검사는 이것만 본다(GROMO-2247, 늘어나는 쪽은 회수할 게 없다). */
    private static final String MEMBER_REMOVED = "MEMBER_REMOVED";

    /** 주민 «집합»이 실제로 바뀌는 changeKind 만 — HOST_TRANSFER 는 무효화할 멤버십이 없다. */
    private static final Set<String> MEMBERSHIP_CHANGE_KINDS = Set.of("MEMBER_ADDED", MEMBER_REMOVED);

    private final JdbcTemplate jdbc;
    private final ChatUserFence chatUserFence;
    private final EventRouter eventRouter;
    private final MembershipService membershipService;
    private final BlockedUsers blockedUsers;
    private final MovementSubscriptionListener movementSubscriptions;
    private final SeaRooms seaRooms;
    private final CurrentMembershipDecisionCache currentMembershipCache;
    private final OutboundAuthzCache outboundAuthzCache;
    private final RealtimeSessionRegistry sessions;
    private final JwtValidator jwtValidator;
    private final Clock clock;
    private final RealtimeEventDelivery eventDelivery;

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
        if (!USER_WITHDRAWN.equals(type) && !USER_BLOCKS_UPDATED.equals(type) && !SEA_MEMBER_UPDATED.equals(type)
                && !AUTH_SESSION_REVOKED.equals(type)
                && !APP_EVENT_TYPES.contains(type)) {
            throw new InvalidEventException();
        }
        int inserted = jdbc.update("INSERT INTO inbound_events (event_id, type) VALUES (?, ?)"
                + " ON CONFLICT (event_id) DO NOTHING", eventId, type);
        if (inserted == 0) {
            log.debug("이미 받은 사건 — eventId={} type={}", eventId, type);
            return false;
        }
        if (USER_WITHDRAWN.equals(type)) {
            UUID withdrawn = uuid(envelope, "userId");
            currentMembershipCache.evictUser(withdrawn); // 탈퇴 직후 허용 결정이 남지 않게 — 펜스보다 먼저
            chatUserFence.withdraw(withdrawn, authGeneration(envelope));
            // 바다 방에서도 내보낸다(GROMO-2300) — Data 의 탈퇴는 진행 중 세션을 벌크 UPDATE 로 ABANDONED 처리해
            // sea.member.updated(ended) 를 내지 않는다(2299 와의 계약). 안 치우면 focusing 유령이 sea:adrift 색인에도 없어
            // 10분 정리가 못 잡고 해시 TTL(24h)까지 정원을 차지한다. 방에 없으면 no-op, Redis 실패만 던진다(재전달).
            seaRooms.leaveCurrent(withdrawn, SeaRooms.LEFT);
            outboundAuthzCache.evictUser(withdrawn);
        } else if (USER_BLOCKS_UPDATED.equals(type)) {
            advanceBlockGeneration(eventId, envelope);
        } else if (SEA_MEMBER_UPDATED.equals(type)) {
            seaRooms.applyMemberUpdated(envelope);
        } else if (AUTH_SESSION_REVOKED.equals(type)) {
            closeRevokedSession(eventId, envelope);
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
        boolean evictionFailed = evictMember(params.get("memberUserId"), uuidOrNull(params.get("islandId")));
        if (MEMBER_REMOVED.equals(changeKind.stringValue())) {
            UUID islandId = uuidOrNull(params.get("islandId"));
            UUID memberUserId = uuidOrNull(params.get("memberUserId"));
            if (evictionFailed) {
                // 옛 「멤버」 캐시가 TTL 동안 남는다 — 그 사람이 지금 이동 outbox 가 없으면 아래 재검사도 잡을 게 없으니,
                // 그 (섬, 사용자)의 다음 이동 구독은 캐시를 건너뛰고 판정받게 표시한다. 재검사보다 먼저다.
                movementSubscriptions.markMembershipCacheStale(islandId, memberUserId);
            }
            recheckMovementAfterCommit(islandId, memberUserId);
        }
    }

    /**
     * 이동 방 강퇴 재검사(GROMO-2247, N7) — 소속이 «줄어드는» MEMBER_REMOVED 만, {@code memberUserId} 가 있으면 그
     * 사람 세션만(없으면 섬 전체) 다시 판정한다. 재검사는 캐시를 읽지 않으므로 위의 캐시 삭제 성패와 무관하다.
     *
     * <p><b>커밋 뒤에</b> 예약한다 — 롤백돼 relay 가 다시 보낼 사건으로 사람을 내보내는 부수 효과를 막는다. 예약도
     * 판정도 이 트랜잭션을 되돌리지 않도록 여기서 한 번 더 감싼다(재검사 쪽도 던지지 않지만 구조로 보장한다).
     */
    private void recheckMovementAfterCommit(UUID islandId, UUID memberUserId) {
        if (islandId == null) {
            return;
        }
        Runnable recheck = () -> {
            try {
                movementSubscriptions.recheckMembership(islandId, memberUserId);
            } catch (RuntimeException e) {
                log.warn("이동 방 재검사 예약 실패 — reason={}", e.getClass().getSimpleName());
            }
        };
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            recheck.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                recheck.run();
            }
        });
    }

    private static UUID uuidOrNull(JsonNode node) {
        try {
            return node == null || !node.isString() ? null : UUID.fromString(node.stringValue());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** @return 캐시 삭제를 시도했는데 Redis 가 실패했으면 true — 옛 답이 TTL 동안 남는다 */
    private boolean evictMember(JsonNode memberUserId, UUID islandId) {
        if (memberUserId == null || !memberUserId.isString()) {
            // 옛 Data — 사용자를 모르니 그 섬의 ON 모드 허용 결정을 통째로 지운다(채팅 경계가 강퇴자를 TTL 동안 통과시키지 않게).
            // Redis 멤버십 캐시는 사용자 키라 TTL 로만 닫힌다.
            log.debug("주민 사건에 memberUserId 가 없다 — 옛 Data. 섬 허용 캐시를 지우고 Redis 캐시는 TTL 로 닫는다.");
            evictIsland(islandId);
            return false;
        }
        try {
            UUID member = UUID.fromString(memberUserId.stringValue());
            currentMembershipCache.evictUser(member); // ON 모드 허용 결정 — Redis 캐시 삭제 성패와 무관하게 먼저
            boolean failed = !membershipService.evict(member);
            outboundAuthzCache.evictUser(member); // 전달 직전 허용 — 원 캐시를 고친 «뒤»(GROMO-2340)
            return failed;
        } catch (IllegalArgumentException e) {
            // 사용자를 모르는 것과 같다 — 섬 단위로 지운다.
            log.warn("memberUserId 가 UUID 형식이 아닙니다 — 섬 허용 캐시만 지웁니다.");
            evictIsland(islandId);
            return false;
        }
    }

    /**
     * 사용자를 모르는 멤버십 사건 — 그 섬의 허용 결정을 두 캐시 모두에서 지운다. ON 모드 결정이 먼저, 전달 직전 허용이 뒤다
     * (사용자 키인 Redis 멤버십 캐시는 고칠 수 없어 TTL 로 닫힌다 — 전달 직전 허용도 그 원본 만료를 넘지 않는다).
     */
    private void evictIsland(UUID islandId) {
        if (islandId != null) {
            currentMembershipCache.evictIsland(islandId);
            outboundAuthzCache.evictIsland(islandId);
        }
    }

    /**
     * 차단자의 차단 세대를 올린다(GROMO-2182). 필드가 없거나 UUID 가 아니면 건너뛴다 — 여기서 400 을 내면 relay 가
     * 그 차단자의 순서 축을 permanent 로 막아 이후 차단·해제 전파까지 멈춘다. TTL 이 백스톱이다.
     */
    private void advanceBlockGeneration(String eventId, JsonNode envelope) {
        JsonNode params = envelope.get("params");
        JsonNode blocker = params == null || !params.isObject() ? null : params.get("blockerUserId");
        UUID blockerId;
        try {
            blockerId = blocker == null || !blocker.isString() ? null : UUID.fromString(blocker.stringValue());
        } catch (IllegalArgumentException e) {
            blockerId = null;
        }
        if (blockerId == null) {
            log.warn("차단 사건에 blockerUserId 가 없다 — 세대를 올리지 않는다. eventId={}", eventId);
            return;
        }
        blockedUsers.advanceGeneration(blockerId);
        outboundAuthzCache.evictUser(blockerId);
    }

    /**
     * 폐기된 로그인 세션({@code params.sessionId} = AT 의 {@code sid})의 STOMP 연결을 닫는다. 같은 사용자의 다른 sid 세션은
     * 건드리지 않는다. 필드가 없거나 UUID 가 아니면 200 + skip — 이 사건이 USER 축을 막으면 탈퇴 전파까지 멈춘다.
     *
     * <p>ponytail: {@code sessionIdsOf} 가 세션 전체를 훑고(O(세션 수)) 그 사용자의 세션마다 JWT 를 푼다 — 폐기 사건은 로그아웃·탈퇴 때뿐이라 싸다. 만료된 AT 를
     * 든 세션은 sid 를 못 읽어 닫지 않는다 — 어차피 모든 SEND·SUBSCRIBE 가 만료로 거절한다.
     */
    private void closeRevokedSession(String eventId, JsonNode envelope) {
        JsonNode params = envelope.get("params");
        UUID userId = uuidOrNull(envelope.get("userId"));
        UUID sid = params == null || !params.isObject() ? null : uuidOrNull(params.get("sessionId"));
        if (userId == null || sid == null) {
            log.warn("세션 폐기 사건에 userId/sessionId 가 없다 — 연결을 닫지 않는다. eventId={}", eventId);
            return;
        }
        // 순서: 펜스(+Redis 내구) → 전 replica 팬아웃 → (세션 목록 스냅샷) → 캐시 → 종료. 펜스가 목록보다 먼저여야 그 사이에 CONNECT·등록을
        // 끝낸 같은 sid 가 «목록에도 없고 펜스에도 안 걸리는» 일이 없다 — CONNECT 는 등록 뒤에도 펜스를 다시 본다.
        // Redis SET 은 한 번(여기)이면 되고 전파를 받은 replica 는 인메모리만 올린다.
        // 의도 — relay 재시도마다 만료가 now+30일로 다시 잡혀 재시도 간격(상한 2^16 s)만큼 늘어나지만 무시할 수준이다.
        chatUserFence.revokeSession(sid, clock.instant().plus(MAX_ACCESS_TOKEN_LIFETIME));
        eventDelivery.publishSessionRevoked(userId, sid);
        closeLocalSessions(userId, sid);
    }

    /**
     * 팬아웃으로 전파받은 세션 폐기 — 이 replica 의 인메모리 펜스·캐시·세션만 정리한다(GROMO-2350). 멱등이다.
     * 전파받은 replica 에서 close 가 실패하면 재시도는 없다(롤백할 트랜잭션이 없다) — 인메모리 펜스가 프레임·SEND·SUBSCRIBE 를 막는다.
     */
    public void applySessionRevocation(UUID userId, UUID sid) {
        chatUserFence.markRevokedLocally(sid, clock.instant().plus(MAX_ACCESS_TOKEN_LIFETIME));
        closeLocalSessions(userId, sid);
    }

    /**
     * 이 JVM 에 붙은 그 사용자의 세션 중 sid 가 같은 것만 닫는다. 한 세션의 종료가 실패해도 나머지를 먼저 닫고 마지막에 던진다 —
     * 수신 인스턴스에서는 던져진 예외가 트랜잭션을 롤백해 relay 가 재시도한다(팬아웃 수신 쪽은 로그만 남기는 리스너가 삼킨다).
     */
    private void closeLocalSessions(UUID userId, UUID sid) {
        List<String> revoked = new ArrayList<>();
        for (String stompId : sessions.sessionIdsOf(userId)) {
            ChatPrincipal principal = sessions.find(stompId);
            String bearer = principal == null ? null : principal.bearer();
            String token = bearer != null && bearer.startsWith("Bearer ") ? bearer.substring(7) : null;
            if (jwtValidator.extractSessionProof(token).filter(p -> sid.equals(p.sessionId())).isPresent()) {
                revoked.add(stompId);
            }
        }
        currentMembershipCache.evictUser(userId);
        CloseStatus status = CloseStatus.POLICY_VIOLATION.withReason("SESSION_REVOKED");
        boolean failed = false;
        for (String stompId : revoked) {
            outboundAuthzCache.evictSession(stompId);
            // 두 번 시도하고도 소켓이 열려 있으면 실패다. 이미 끊긴 세션(close 가 false 여도 isConnected false)은 성공으로 본다.
            boolean closed = sessions.close(stompId, status) || sessions.close(stompId, status);
            failed |= !closed && sessions.isConnected(stompId);
        }
        if (failed) {
            throw new IllegalStateException("폐기된 세션의 연결을 닫지 못했다");
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
            event = RealtimeEventType.ISLAND_MEMBER_ARRIVED.wireName().equals(type)
                    ? arrivalEvent(eventId, envelope) : memberEvent(eventId, type, envelope);
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

    /**
     * 주민 첫 도착(GROMO-2302) 봉투 10필드 → 7필드(봉투 기준 — payload 는 {@link #ARRIVAL_FIELDS} 5필드만).
     * {@link #memberEvent} 와 달리 params 를 그대로 쓰지 않고
     * {@link #ARRIVAL_FIELDS} 만 복사한다 — 이름·털색을 싣는 사건이라 생산자가 필드를 늘려도 앱으로 새지 않게 한다.
     * {@code aggregateVersion} 은 봉투 version({@code ISLAND_ARRIVAL} 축)이다.
     */
    private static RealtimeEventEnvelope arrivalEvent(String eventId, JsonNode envelope) {
        JsonNode params = envelope.get("params");
        if (params == null || !params.isObject()) {
            throw new IllegalArgumentException("도착 사건 params 가 객체가 아닙니다.");
        }
        ObjectNode payload = JsonNodeFactory.instance.objectNode();
        for (String field : ARRIVAL_FIELDS) {
            if (params.has(field)) {
                payload.set(field, params.get(field));
            }
        }
        return new RealtimeEventEnvelope(UUID.fromString(eventId), intValue(envelope, "schemaVersion"),
                RealtimeEventType.ISLAND_MEMBER_ARRIVED, UUID.fromString(requiredText(envelope, "subjectId")),
                longValue(envelope, "version"), Instant.parse(requiredText(envelope, "occurredAt")), payload);
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

package com.oneorthree.realtime.message.service;

import com.oneorthree.realtime.common.id.UuidV7;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.repository.ChatMessageRepository;
import com.oneorthree.realtime.message.repository.ChatReadCursorRepository;
import com.oneorthree.realtime.common.redis.RedisKeys;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 탈퇴 tombstone 과 읽음 커서 쓰기를 <b>같은 사용자 잠금</b>으로 직렬화한다 (GROMO-1943 · 계정 LLD §4).
 *
 * <p>잠금은 사용자 UUID 로 정해지는 트랜잭션 범위 advisory lock 이다 — 커서·tombstone 행이 아직 없는
 * 사용자도 같은 키로 잠가야 해서 행 잠금으로는 안 된다. 두 순서 모두 닫힌다:
 * <ul>
 *   <li>커서 쓰기가 먼저 잠그면 탈퇴 처리가 기다렸다가 방금 쓴 커서까지 지운다</li>
 *   <li>탈퇴 처리가 먼저면 이미 멤버십 검사를 통과한 요청도 잠금 뒤 tombstone 을 보고 거절된다</li>
 * </ul>
 * 멤버십 캐시(최대 120초)가 탈퇴자를 통과시켜도 여기서 막힌다 — 캐시 무효화는 보조일 뿐이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatUserFence {

    private final JdbcTemplate jdbc;
    private final ChatReadCursorRepository chatReadCursorRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final Clock clock;
    private final StringRedisTemplate redis;
    private final MeterRegistry meterRegistry;

    /**
     * 폐기된 로그인 세션(AT 의 {@code sid}) → 그 AT 가 만료되는 시각(GROMO-2350). 기본 인가 OFF 모드는 전달 직전 인가가 sid 를 보지
     * 않아, 소켓을 닫아도 앱이 저장된 AT 로 재연결하면 같은 sid 가 되살아난다 — CONNECT 가 이 펜스로 거절한다.
     *
     * <p>두 겹이다. 이 인메모리 맵은 <b>프레임마다</b> 보는 쪽(왕복 없음)이고, {@link RedisKeys#revokedSession} 키(TTL = 만료까지)는
     * 재시작·다른 인스턴스의 <b>CONNECT</b>·REST 가 보는 내구 쪽이다. 폐기 사건은 수신 인스턴스가
     * 기존 팬아웃 채널({@code chat:events:v1})로 전 replica 에 퍼뜨려 각 replica 가 이 인메모리 펜스를 올리고 자기 세션을 닫는다. 남는 한계:
     * 팬아웃 발행이 유실되면 다른 replica 에 이미 붙은 세션은 AT 만료까지 살 수 있다 — 그 replica 의 재연결·REST 는 Redis 펜스가 막는다.
     */
    private final Map<UUID, Instant> revokedSessions = new ConcurrentHashMap<>();

    /**
     * {@code user.withdrawn} 적용 — tombstone 확정 → 그 사용자의 모든 방 커서 삭제. 한 로컬 TX 다.
     *
     * <p>멱등이다: 두 번째 전달은 세대를 {@code GREATEST} 로만 맞추고 지울 커서가 없다. 역순으로 온 낮은
     * 세대가 폐기를 되돌리지도 않는다.
     *
     * @return 지운 커서 행 수
     */
    @Transactional
    public int withdraw(UUID userId, long authGeneration) {
        lock(userId);
        jdbc.update("INSERT INTO user_tombstones (user_id, auth_generation, withdrawn_at) VALUES (?, ?, ?)"
                + " ON CONFLICT (user_id) DO UPDATE SET auth_generation ="
                + " GREATEST(user_tombstones.auth_generation, EXCLUDED.auth_generation)",
                userId, authGeneration, Timestamp.from(clock.instant()));
        return jdbc.update("DELETE FROM chat_read_cursors WHERE user_id = ?", userId);
    }

    /**
     * 폐기된 세션을 {@code until}(그 AT 의 만료)까지 거절 대상으로 올린다. 이미 있으면 더 늦은 만료를 남긴다.
     *
     * <p>ponytail: 올릴 때마다 만료분을 O(항목 수)로 쓸어낸다 — 폐기는 로그아웃·탈퇴 때뿐이다.
     */
    public void revokeSession(UUID sessionId, Instant until) {
        markRevokedLocally(sessionId, until);
        long ttlMillis = Duration.between(clock.instant(), until).toMillis();
        if (ttlMillis > 0) {
            try {
                redis.opsForValue().set(RedisKeys.revokedSession(sessionId), "1", Duration.ofMillis(ttlMillis));
            } catch (RuntimeException e) {
                // 내구 펜스는 보조다 — 인메모리 펜스와 즉시 종료(전 replica 팬아웃)가 주된 차단이다. 여기서 던지면 Redis 장애 동안 폐기 사건마다
                // 500 → relay 백오프로 그 사용자 USER 축이 막힌다(읽기 fail-open 과도 상충). 대가: 이 장애 중 재시작·유실이 겹치면 그 sid 의
                // CONNECT·REST 가 AT 만료까지 열린다.
                fenceFailed("write");
                log.warn("폐기 세션 펜스 Redis 쓰기 실패 — 인메모리 펜스로 계속한다. cause={}", e.getClass().getSimpleName());
            }
        }
    }

    /**
     * Redis 내구 펜스 실패 계수 — {@code realtime.session.revoked.fence{op=read|write,result=failed}}.
     * 읽기 실패는 fail-open(CONNECT·REST 펜스가 꺼진 상태), 쓰기 실패는 내구 펜스가 안 선 상태다.
     * 둘 다 5분 증가분이 0 보다 크면 알린다. 처음 실패할 때 계열이 생긴다.
     */
    private void fenceFailed(String op) {
        meterRegistry.counter("realtime.session.revoked.fence", "op", op, "result", "failed").increment();
    }

    /** 이 JVM 의 인메모리 펜스만 올린다 — 팬아웃으로 전파를 받은 replica 용(Redis 는 수신 인스턴스가 한 번 썼다). 멱등: 더 늦은 만료만 남긴다. */
    public void markRevokedLocally(UUID sessionId, Instant until) {
        Instant now = clock.instant();
        revokedSessions.values().removeIf(expiry -> !expiry.isAfter(now));
        revokedSessions.merge(sessionId, until, (a, b) -> a.isAfter(b) ? a : b);
    }

    /**
     * CONNECT 용 — 인메모리 «또는» Redis(왕복 1회). 재시작·다른 인스턴스에서 올린 펜스까지 본다.
     *
     * <p>Redis 읽기 실패는 «폐기 아님»으로 두고 경고만 남긴다(fail-open). {@code MembershipService} 의 캐시 실패 처리와 같은 관례다 —
     * 여기서 닫으면 Redis 장애 한 번이 모든 사용자의 접속을 끊는데, 열어 둬서 생기는 위험은 «폐기된 AT 가 만료 전까지 재연결»이고
     * 그 사이에도 프레임 전달은 인메모리 펜스가 막는다. ({@code BlockedUsers} 의 fail-closed 는 «켜진 필터가 판정 못 내리면 프레임을
     * 안 보낸다»는 별개 결정이다.)
     */
    public boolean isRevokedDurable(UUID sessionId) {
        if (isRevoked(sessionId)) {
            return true;
        }
        try {
            return sessionId != null && Boolean.TRUE.equals(redis.hasKey(RedisKeys.revokedSession(sessionId)));
        } catch (RuntimeException e) {
            fenceFailed("read");
            log.warn("폐기 세션 펜스 조회 실패 — 폐기 아님으로 둔다. cause={}", e.getClass().getSimpleName());
            return false;
        }
    }

    /** 이 sid 가 폐기돼 아직 AT 만료 전인가(인메모리만 — 프레임마다 불러도 왕복이 없다). 만료 뒤엔 AT 자체가 거절되므로 항목을 지운다. */
    public boolean isRevoked(UUID sessionId) {
        Instant until = sessionId == null ? null : revokedSessions.get(sessionId);
        if (until == null) {
            return false;
        }
        if (until.isAfter(clock.instant())) {
            return true;
        }
        revokedSessions.remove(sessionId, until);
        return false;
    }

    /**
     * 읽음 커서 저장의 <b>유일한</b> 관문 — 사용자 잠금 → tombstone 재검사 → 메시지 소속 재검사 → UPSERT.
     *
     * <p>외부 접근 검사(Redis·Data HTTP)는 호출부가 이 TX <b>밖</b>에서 끝낸다 — 커넥션을 쥔 채 네트워크를
     * 기다리지 않는다.
     *
     * @throws ChatException 탈퇴한 사용자면 {@code NOT_A_MEMBER}, 그 섬의 메시지가 아니면 {@code INVALID_CURSOR}
     */
    @Transactional
    public void writeReadCursor(UUID groupId, UUID userId, UUID lastReadMessageId) {
        lock(userId);
        if (isWithdrawn(userId)) {
            throw new ChatException(ChatErrorCode.NOT_A_MEMBER);
        }
        if (!chatMessageRepository.existsByIdAndGroupId(lastReadMessageId, groupId)) {
            throw new ChatException(ChatErrorCode.INVALID_CURSOR);
        }
        chatReadCursorRepository.upsertIfNewer(UuidV7.next(), groupId, userId, lastReadMessageId, clock.instant());
    }

    private boolean isWithdrawn(UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM user_tombstones WHERE user_id = ?)", Boolean.class, userId));
    }

    private void lock(UUID userId) {
        jdbc.queryForObject("SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(?, 0))", Integer.class,
                "chat-user:" + userId);
    }
}

package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 로그인 세션 개설·폐기와 알림 서버 전달을 같은 트랜잭션에 기록한다.
 *
 * <p>각 세션의 RT 해시가 자격의 정본이다. 개별 로그아웃은 해당 세션만 폐기하고,
 * 전 기기 로그아웃·탈퇴는 사용자 세대와 전체 세션을 함께 폐기한다.
 */
@Slf4j
@Service
public class AuthSessionService {

    /** 사건 종류 — 봉투 {@code type}. */
    public static final String EVENT_SESSION_REVOKED = "auth.session.revoked";

    /** 사건 종류 — 유저 축 세대가 올랐다(㊹). 삭제 명령과 <b>별개 사건</b>이다. */
    public static final String EVENT_GENERATION_BUMPED = "auth.generation.bumped";

    /** 알림 서버의 세션 폐기 명령 논리 키. 실제 URL·토큰은 relay 설정의 허용목록에만 있다. */
    public static final String ENDPOINT_SESSION_REVOKED = "noti.sessionRevoked";

    /** 알림 서버의 세대 전달 논리 키. */
    public static final String ENDPOINT_GENERATION_BUMPED = "noti.authGenerationBumped";

    private static final int SCHEMA_VERSION = 1;
    private static final int NONCE_BYTES = 32;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final AuthSessionRepository authSessionRepository;
    private final LoginAttemptRepository loginAttemptRepository;
    private final OutboxCommandPort outboxCommandPort;
    private final Clock clock;
    /** GROMO-2350 — true 면 폐기 사건을 Realtime 에도 보내 그 세션의 STOMP 연결을 닫게 한다. 기본 OFF. */
    private final boolean realtimeEventsEnabled;
    /** AT 수명(초) — 폐기 시각에 더하면 그 세션이 발급한 모든 AT 의 만료 상한이다. */
    private final long accessExpirationSeconds;

    public AuthSessionService(AuthSessionRepository authSessionRepository,
            LoginAttemptRepository loginAttemptRepository, OutboxCommandPort outboxCommandPort, Clock clock,
            @Value("${auth.session-revoked.realtime-events-enabled:false}") boolean realtimeEventsEnabled,
            @Value("${jwt.access-expiration}") long accessExpirationSeconds) {
        this.authSessionRepository = authSessionRepository;
        this.loginAttemptRepository = loginAttemptRepository;
        this.outboxCommandPort = outboxCommandPort;
        this.clock = clock;
        this.realtimeEventsEnabled = realtimeEventsEnabled;
        this.accessExpirationSeconds = accessExpirationSeconds;
    }

    /**
     * 로그인 세션을 연다 — <b>발급된 RT 와 같은 트랜잭션에서</b>.
     *
     * @param userId       세션 주인
     * @param refreshToken 방금 발급한 RT 원문. 저장은 해시만 한다(GROMO-713 과 같은 규율)
     * @return 세션 식별·fencing 값과 <b>1회 노출되는</b> {@code deviceBootstrap} 원문
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public IssuedSession open(UUID userId, String refreshToken) {
        // fencing 값은 유저 축 aggregate 행 «잠금 아래» 발급한다 — 시퀀스는 할당 순서만 보장하고
        // 커밋 순서를 보장하지 않아(㊸), 늦게 커밋된 옛 세션이 더 큰 값을 들 수 있다.
        long sessionEpoch = outboxCommandPort.allocateVersion(AggregateRef.ofUser(userId));
        String bootstrap = newBootstrapNonce();
        AuthSession session = authSessionRepository.save(AuthSession.builder()
                .userId(userId)
                .refreshTokenHash(TokenHasher.sha256Hex(refreshToken))
                .bootstrapNonceHash(TokenHasher.sha256Hex(bootstrap))
                .sessionEpoch(sessionEpoch)
                .build());
        return new IssuedSession(session.getId(), sessionEpoch, bootstrap);
    }

    /**
     * RT 로 세션을 찾는다 — <b>읽기 전용</b>이다. AT 의 {@code sid} claim 을 채우는 데 쓴다.
     *
     * @param refreshToken RT 원문
     * @return 그 RT 를 인정하는 세션. 존재하지 않는 해시는 빈 값이다
     */
    @Transactional(propagation = Propagation.MANDATORY, readOnly = true)
    public Optional<AuthSession> findByRefreshToken(String refreshToken) {
        return authSessionRepository.findByRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));
    }

    /** users 잠금을 먼저 가진 RT 전용 종료가 정확한 해시의 세션을 잠근다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<AuthSession> findLogoutSessionForUpdate(String hash) {
        return authSessionRepository.findByRefreshTokenHashForUpdate(hash);
    }

    /** 세션 epoch·종료 증거·bootstrap 폐기 전달을 한 TX에 확정한다. 기기 삭제 명령은 없다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void completeLogout(AuthSession session, Instant refreshExpiresAt) {
        long epoch = outboxCommandPort.allocateVersion(AggregateRef.ofUser(session.getUserId()));
        session.revokeForLogout(clock.instant(), refreshExpiresAt, epoch);
        appendSessionRevoked(session);
    }

    /**
     * 전 기기 로그아웃·탈퇴 — 유저의 <b>모든</b> 세션을 폐기한다.
     *
     * <p>세대 증가는 여기서 하지 않는다. 호출부가 {@code users} 행을 배타 락으로 들고 있어야 하고
     * (더티 체킹이 전 컬럼을 덮으므로), 그 락의 소유자는 탈퇴·로그아웃 절차다.
     *
     * @param userId 유저
     * @param reason 폐기 사유 — 관측용
     * @return 이번에 실제로 폐기된 세션들
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<AuthSession> revokeAll(UUID userId, String reason) {
        List<AuthSession> active = authSessionRepository.findActiveByUserId(userId);
        active.forEach(session -> {
            if (session.revoke(clock.instant(), reason)) {
                appendSessionRevoked(session);
            }
        });
        return active;
    }

    /**
     * 탈퇴자의 로그인 자격을 파기한다 (GROMO-1801 · 계정 LLD §4). {@link #revokeAll} 로 모든 세션을 폐기한
     * «뒤»에 부른다 — 폐기 사건이 봉투를 적은 다음이라야 RT·bootstrap 해시를 지워도 전달할 증명이 남는다.
     * 로그인 시도 원장도 INVALIDATED 로 닫아 복구 창 안의 재생을 막는다.
     *
     * @param userId 탈퇴 중인 유저
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void eraseWithdrawnCredentials(UUID userId) {
        authSessionRepository.eraseCredentialsOfUser(userId);
        loginAttemptRepository.invalidateAndEraseOfUser(userId, clock.instant());
    }

    /**
     * 올라간 유저 축 세대를 알림 서버에 <b>별도 사건</b>으로 전달한다 (㊹).
     *
     * <p>삭제 outbox 에 실어 보낼 수 없다 — 앱은 토큰 {@code DELETE} 를 {@code logout} 보다 <b>먼저</b>
     * 부르므로 그 봉투에는 증가 전 세대만 담긴다. 그러면 지연 등록이 「같은 세대」로 수락돼 토큰이
     * 되살아난다.
     *
     * @param userId        유저
     * @param newGeneration 올린 <b>뒤</b>의 세대
     * @param reason        {@code WITHDRAW} · {@code LOGOUT_ALL}
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void publishGenerationBumped(UUID userId, long newGeneration, String reason) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("authGeneration", newGeneration);
        params.put("reason", reason);
        outboxCommandPort.append(new OutboxAppendCommand(
                EVENT_GENERATION_BUMPED + ":" + userId + ":" + newGeneration,
                SCHEMA_VERSION,
                EVENT_GENERATION_BUMPED,
                userId,
                null,
                null,
                AggregateRef.ofUser(userId),
                null,
                params,
                List.of(OutboxDeliveryRequest.toNotification(ENDPOINT_GENERATION_BUMPED, null))));
    }

    /**
     * {@code deviceBootstrap} 세션 확인 (㋤ · ㋨) — <b>배타 잠금</b>으로 읽는다.
     *
     * <p>확인만으로는 TOCTOU 가 남는다. 그래서 살아 있는 세션의 {@code sessionEpoch} 를 함께 돌려주고,
     * 알림 서버가 자기 tombstone 과 원자 대조한 뒤에만 소유권을 바꾼다.
     *
     * <p><b>비활성일 때도 마지막 값을 돌려준다</b> — 그 값이 tombstone 비교의 기준이라, 여기서 0 을
     * 주면 이미 끝난 세션의 지연 등록이 「가장 오래된 값」으로 통과할 수 있다.
     *
     * @param userId          확인 대상 유저
     * @param deviceBootstrap 앱이 제시한 자격 원문
     * @return 세션이 있으면 그 행. 자격이 없거나 남의 것이면 비어 있다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<AuthSession> verifyBootstrap(UUID userId, String deviceBootstrap) {
        if (deviceBootstrap == null || deviceBootstrap.isBlank()) {
            return Optional.empty();
        }
        return authSessionRepository.findByUserIdAndBootstrapNonceHashForUpdate(
                userId, TokenHasher.sha256Hex(deviceBootstrap));
    }

    /**
     * 서명된 {@code sid} 로 하는 세션 확인 (㋤ 의 구 앱 경로).
     *
     * <p>구 앱은 {@code deviceBootstrap} 을 저장하지 않아 자격을 제시하지 못한다. 그래도 그 앱이 쓰는
     * AT 는 이제 이 서버가 발급하며 {@code sid} 를 싣는다 — <b>위조할 수 없는 값</b>이고, 자격 원문을
     * 주고받지 않으므로 1회용 자격을 대신 발급해 주는 것(= 위조)과는 다르다. 자격 축의 「미사용
     * 1회용」 판정은 여기서 하지 않는다: 이 확인은 <b>세션이 지금 살아 있는가</b>만 답한다.
     *
     * @param userId    확인 대상 유저
     * @param sessionId AT 의 {@code sid} claim
     * @return 세션이 있으면 그 행. 없거나 남의 것이면 비어 있다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<AuthSession> verifySession(UUID userId, UUID sessionId) {
        if (sessionId == null) {
            return Optional.empty();
        }
        return authSessionRepository.findByIdAndUserIdForUpdate(sessionId, userId);
    }

    /**
     * 서명된 {@code sid}·{@code gen} 이 지금도 이 사용자의 살아 있는 세션인지 확인한다 (GROMO-2207).
     *
     * <p>호출자가 {@code users} 행을 {@code FOR UPDATE} 로 잠근 TX 안에서 부른다 — 로그아웃도 같은 행을 먼저
     * 잠그므로(users → auth_sessions) 둘이 직렬화된다. 단일 로그아웃은 세대를 올리지 않으므로 세션 행 검사가
     * 반드시 필요하고, 같은 사용자의 다른 활성 세션은 영향받지 않는다.
     *
     * <p>잠근 {@code users} 행은 호출자(L10 internal)가 읽어 id·세대를 값으로 넘긴다 — {@code auth} 가
     * {@code user.repository} 를 직접 참조하지 않게 하기 위해서다 (GROMO-2198 규칙).
     *
     * @param userId                 잠근 활성 사용자의 id
     * @param currentAuthGeneration  잠근 사용자 행의 현재 인증 세대
     * @param sessionId              AT 의 {@code sid}
     * @param claimedAuthGeneration  AT 의 {@code gen}
     * @throws AuthException 하나라도 없거나 어긋나면 {@link AuthErrorCode#SESSION_NOT_ACTIVE}
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void requireActive(UUID userId, long currentAuthGeneration, UUID sessionId, Long claimedAuthGeneration) {
        if (sessionId == null || claimedAuthGeneration == null
                || claimedAuthGeneration.longValue() != currentAuthGeneration
                || verifySession(userId, sessionId).filter(AuthSession::isActive).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
    }

    private void appendSessionRevoked(AuthSession session) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("sessionId", session.getId().toString());
        params.put("sessionEpoch", session.getSessionEpoch());
        // 알림 서버가 「어느 nonce 를 폐기할지」를 잇는 유일한 키다 (A22 ㋞ · ㋨). 등록 요청에는
        // deviceBootstrap 만 실리고 sessionId 는 없으므로, 알림 서버는 등록 때 SHA-256(deviceBootstrap)
        // 을 저장해 두고 이 해시로 tombstone 을 찾는다.
        //
        // ⚠️ 원문 nonce 는 싣지 않는다 — 이벤트는 브로커·로그·DLT 에 남고, 그 자리에 자격 원문이
        //    있으면 그게 곧 「소유권 이전 자격」의 유출이다. 해시는 대조에만 쓰인다.
        params.put("bootstrapNonceHash", session.getBootstrapNonceHash());
        params.put("reason", session.getRevokeReason());
        // GROMO-2386 — 이 sid 로 발급된 AT 의 만료 상한(ISO-8601). realtime 폐기 펜스 TTL 의 근거다.
        params.put("accessTokenExpiresAt", session.getRevokedAt().plusSeconds(accessExpirationSeconds).toString());
        outboxCommandPort.append(new OutboxAppendCommand(
                EVENT_SESSION_REVOKED + ":" + session.getId(),
                SCHEMA_VERSION,
                EVENT_SESSION_REVOKED,
                session.getUserId(),
                null,
                session.getId().toString(),
                AggregateRef.ofUser(session.getUserId()),
                null,
                params,
                realtimeEventsEnabled
                        ? List.of(OutboxDeliveryRequest.toNotification(ENDPOINT_SESSION_REVOKED, null),
                                OutboxDeliveryRequest.toRealtime(EVENT_SESSION_REVOKED, null))
                        : List.of(OutboxDeliveryRequest.toNotification(ENDPOINT_SESSION_REVOKED, null))));
    }

    private static String newBootstrapNonce() {
        byte[] bytes = new byte[NONCE_BYTES];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * 개설·회전의 결과.
     *
     * @param sessionId    세션 식별자 — AT 의 {@code sid} claim 이 된다
     * @param sessionEpoch fencing 값
     * @param deviceBootstrap 1회 노출되는 자격 원문. 회전에서는 새로 발급하지 않아 {@code null}
     */
    public record IssuedSession(UUID sessionId, long sessionEpoch, String deviceBootstrap) {
    }
}

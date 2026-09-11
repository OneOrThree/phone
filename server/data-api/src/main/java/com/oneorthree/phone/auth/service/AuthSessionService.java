package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
 * 세션 축의 쓰기 — 개설·회전·폐기와 그 <b>내구 전달</b> (A22 ㋣ · ㋞ · ㊼ · ㊹).
 *
 * <h2>왜 축을 따로 두는가</h2>
 * 현행은 유저 행에 RT 해시가 하나뿐이라 「개별 기기 로그아웃」을 표현할 자리가 없다. 그래서 전
 * 기기가 같이 끊기거나(그 하나를 지우면) 아무도 안 끊긴다. 세대(유저 축)를 개별 로그아웃에 올리는
 * 대안은 <b>더 나쁘다</b>(㊼) — 로그인 중인 다른 기기의 재등록이 거부돼 그 기기 푸시가 끊긴다.
 *
 * <h2>세션 행이 있으면 그 행이 권위다</h2>
 * {@code users.refresh_token_hash} 는 <b>마지막 로그인 하나</b>만 담는다. 그걸 먼저 보면 B 기기
 * 로그인이 그 값을 덮는 순간 A 기기의 갱신·회전이 전부 실패해, 세션 축을 따로 둔 의미가 사라진다
 * (codex R10 P1). 그래서 <b>세션 행이 있는 RT 는 이 축이 판정·회전</b>하고, 유저 행의 해시는
 * 세션 행이 없는 구 RT 의 판정에만 쓴다.
 *
 * <h2>기존 경로를 깨지 않는다</h2>
 * 그 구 RT 경로는 그대로 산다(㋪ — 곧장 전환하면 최대 RT 수명 동안 구 토큰을 든 사용자가 전부
 * 끊기고, 게스트에게 그것은 계정 소실이다). 승격은 {@link #promoteLegacy} 의 첫 회전에서만 일어난다.
 *
 * <h2>전부 호출자의 트랜잭션 안에서</h2>
 * {@code Propagation.MANDATORY} 다. 세션 행과 outbox 봉투는 <b>로그인·로그아웃 트랜잭션과 같은
 * 커밋</b>이어야 한다 — 따로 커밋되면 「세션은 끊겼는데 알림 서버는 모르는」 구간이 생기고, 그 구간의
 * 지연 등록이 이미 로그아웃한 계정의 토큰을 되살린다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
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
    private final OutboxCommandPort outboxCommandPort;
    private final Clock clock;

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
     * 살아 있는 세션의 RT 회전 — <b>그 세션 행만</b> 갈아끼운다 (A22 ㋣).
     *
     * <p>{@code users.refresh_token_hash} 가 아니라 <b>이 행</b>이 회전의 권위다. 유저 행의 해시는
     * 하나뿐이라 B 기기 로그인이 그 값을 덮으면 A 기기의 회전이 영영 실패한다 — 세션이 여럿이라는
     * 계약은 세션 행 CAS 위에서만 성립한다(codex R10 P1).
     *
     * <p><b>전제</b>: 호출부가 {@code users} 행 배타 락을 쥐고 있고, 넘겨준 세션은 그 락 아래에서
     * 조회됐다. 같은 유저의 로그인·갱신·로그아웃·탈퇴가 모두 그 락을 선두에서 잡으므로,
     * 여기서 잡는 {@code aggregate_versions} → {@code auth_sessions} 순서는 다른 auth 경로와
     * 경합하지 않는다.
     *
     * <p>그래도 쓰기는 {@link AuthSessionRepository#rotateIfCurrent} 의 조건부 UPDATE 로 낸다 —
     * 락 규율이 깨지는 날 엔티티 dirty checking 은 동시 회전 둘을 다 성공시키거나 그 사이의 폐기를
     * 되살리지만, CAS 는 조용히 덮는 대신 <b>0 을 돌려준다</b>. 대신 벌크 UPDATE 는 영속성 컨텍스트를
     * 갱신하지 않으므로 <b>넘겨받은 엔티티는 읽기만 하고 고치지 않는다</b>.
     *
     * @param session         {@link #findByRefreshToken} 으로 읽은 현재 세션 행
     * @param oldRefreshToken 회전 전 RT 원문 — CAS 기대값의 재료
     * @param newRefreshToken 회전 후 RT 원문
     * @return 회전된 세션의 식별·fencing 값. <b>비어 있으면</b> 동시 회전의 패자이거나 그 사이
     *     세션이 끊긴 것이므로 호출부가 거절해야 한다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<IssuedSession> rotateActive(AuthSession session, String oldRefreshToken,
                                                String newRefreshToken) {
        // fencing 값은 유저 축 aggregate 행 잠금 아래 발급한다(㊸) — open() 과 같은 이유다.
        // 호출부가 users 를 이미 잠갔으므로 여기서의 순서는 aggregate → auth_sessions 이고,
        // 그것은 로그인(open)·로그아웃(revoke)·탈퇴(revokeAll)가 같은 락 아래에서 쓰는 순서와 같다.
        long sessionEpoch = outboxCommandPort.allocateVersion(AggregateRef.ofUser(session.getUserId()));
        // 자격이 이미 있으면 «그대로 둔다». 회전마다 새로 발급하면 그 응답이 유실됐을 때 앱이 든
        // 값이 영구히 낡아, 세션 확인이 되는 기기가 오히려 확인 없는 경로로 떨어진다.
        String issuedBootstrap = session.getBootstrapNonceHash() == null ? newBootstrapNonce() : null;
        String nonceHash = issuedBootstrap == null
                ? session.getBootstrapNonceHash()
                : TokenHasher.sha256Hex(issuedBootstrap);
        int rotated = authSessionRepository.rotateIfCurrent(
                session.getId(),
                TokenHasher.sha256Hex(oldRefreshToken),
                TokenHasher.sha256Hex(newRefreshToken),
                nonceHash,
                sessionEpoch,
                clock.instant());
        if (rotated == 0) {
            return Optional.empty();
        }
        return Optional.of(new IssuedSession(session.getId(), sessionEpoch, issuedBootstrap));
    }

    /**
     * 구 RT 승격(백필) — 세션 축에 올리는 <b>유일한</b> 자리다 (㋪).
     *
     * <p>구 RT 에는 {@code sessionId} 가 없어 첫 회전에서만 세션 행을 만들 수 있다. 그 행은
     * {@code legacy=true} 이고, 자격도 이때 처음 발급한다.
     *
     * @param userId          세션 주인 — 승격 직전 {@code users} CAS 로 소유가 확인된 유저다
     * @param newRefreshToken 회전 후 RT 원문
     * @return 승격된 세션의 식별·fencing 값과 처음 발급한 자격 원문
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public IssuedSession promoteLegacy(UUID userId, String newRefreshToken) {
        long sessionEpoch = outboxCommandPort.allocateVersion(AggregateRef.ofUser(userId));
        String bootstrap = newBootstrapNonce();
        AuthSession promoted = authSessionRepository.save(AuthSession.builder()
                .userId(userId)
                .refreshTokenHash(TokenHasher.sha256Hex(newRefreshToken))
                .bootstrapNonceHash(TokenHasher.sha256Hex(bootstrap))
                .sessionEpoch(sessionEpoch)
                .legacy(true)
                .build());
        return new IssuedSession(promoted.getId(), sessionEpoch, bootstrap);
    }

    /**
     * RT 로 세션을 찾는다 — <b>읽기 전용</b>이다. AT 의 {@code sid} claim 을 채우는 데 쓴다.
     *
     * @param refreshToken RT 원문
     * @return 그 RT 를 인정하는 세션. 구 RT 는 아직 세션 행이 없어 비어 있다(㋪)
     */
    @Transactional(propagation = Propagation.MANDATORY, readOnly = true)
    public Optional<AuthSession> findByRefreshToken(String refreshToken) {
        return authSessionRepository.findByRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));
    }

    /**
     * 구 RT 로그아웃도 응답 유실 후 같은 해시로 완료 여부를 찾을 수 있게 세션 원장에 남긴다.
     * 호출자는 users 행을 잠그고 현재 RT 해시가 일치함을 확인해야 한다. 새 bootstrap 은 발급하지 않는다.
     *
     * @param userId 검증된 RT 소유자
     * @param refreshToken 검증된 구 RT
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordLegacyLogoutSession(UUID userId, String refreshToken) {
        long epoch = outboxCommandPort.allocateVersion(AggregateRef.ofUser(userId));
        authSessionRepository.save(AuthSession.builder().userId(userId)
                .refreshTokenHash(TokenHasher.sha256Hex(refreshToken)).sessionEpoch(epoch).legacy(true).build());
    }

    /**
     * 개별 기기 로그아웃 — <b>그 세션만</b> 폐기하고 알림 서버에 내구 전달한다 (㋞ · ㊼).
     *
     * <p>유저 축 세대는 올리지 않는다. 올리면 로그인 중인 다른 기기의 {@code onTokenRefresh} 재등록이
     * 거부돼 그 기기 푸시가 끊긴다.
     *
     * @param refreshToken 로그아웃 요청이 제시한 RT 원문
     * @return 폐기된 세션. 세션 행이 없는 구 RT 면 비어 있다 — 그 경우도 오류가 아니다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<AuthSession> revokeByRefreshToken(String refreshToken) {
        Optional<AuthSession> found =
                authSessionRepository.findByRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));
        found.ifPresent(session -> {
            if (session.revoke(clock.instant(), "LOGOUT")) {
                appendSessionRevoked(session);
            }
        });
        return found;
    }

    /** users 잠금을 먼저 가진 RT 전용 종료가 정확한 해시의 세션을 잠근다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<AuthSession> findLogoutSessionForUpdate(String hash) {
        return authSessionRepository.findByRefreshTokenHashForUpdate(hash);
    }

    /** 기존 users 해시로 증명한 sid 없는 RT의 종료행만 만든다. bootstrap은 발급하지 않는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public AuthSession createLegacyLogoutSession(UUID userId, String hash) {
        return authSessionRepository.save(AuthSession.builder().userId(userId).refreshTokenHash(hash)
                .sessionEpoch(0L).legacy(true).build());
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
                List.of(OutboxDeliveryRequest.toNotification(ENDPOINT_SESSION_REVOKED, null))));
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

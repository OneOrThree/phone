package com.oneorthree.phone.auth.repository;

import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.UUID;

/** 로그인 시도 원장 (GROMO-1908, 계정 LLD §3). */
public interface LoginAttemptRepository extends JpaRepository<LoginAttempt, UUID> {

    /**
     * 시도의 <b>실행권을 선점</b>한다 — 이미 있으면 아무것도 하지 않는다.
     *
     * <p>{@code save()} 가 아닌 이유는 {@code CommandIdempotencyRepository.insertClaim} 과 같다:
     * 동시 요청에서 UNIQUE 위반 예외가 트랜잭션을 오염시키면 <b>재생조차 못 한다</b>. 이 문장은
     * 상대 트랜잭션이 끝날 때까지 기다렸다가 0 을 돌려주므로, 진 쪽은 저장된 상태를 읽어 재생하거나
     * 「진행 중」을 답할 수 있다.
     *
     * <p>이것이 «같은 code 를 동시에 교환하지 않는다»(LLD §3-3)의 직렬화 지점이다 — 1 을 받은
     * 하나만 제공자를 부른다.
     *
     * @return 1 = 이 호출이 선점했다(제공자 교환을 실행한다), 0 = 이미 있다(조회해서 판정한다)
     */
    @Modifying
    @Query(value = "INSERT INTO login_attempts "
            + "(attempt_id, status, digest_key_id, credential_digest, provider, credential_kind, "
            + " terms_version, claimed_at, recovery_expires_at, created_at, updated_at) "
            + "VALUES (:attemptId, 'PENDING', :digestKeyId, :digest, :provider, :credentialKind, "
            + " :termsVersion, :now, :recoveryExpiresAt, :now, :now) "
            + "ON CONFLICT (attempt_id) DO NOTHING", nativeQuery = true)
    int insertClaim(
            @Param("attemptId") UUID attemptId,
            @Param("digestKeyId") String digestKeyId,
            @Param("digest") String digest,
            @Param("provider") String provider,
            @Param("credentialKind") String credentialKind,
            @Param("termsVersion") String termsVersion,
            @Param("now") Instant now,
            @Param("recoveryExpiresAt") Instant recoveryExpiresAt);

    /**
     * 만료된 PENDING 임차를 <b>조건부로</b> 회수한다.
     *
     * <p>조건을 {@code claimed_at = :expectedClaimedAt} 으로 두는 것이 핵심이다. 읽고 나서 쓰는
     * 사이에 다른 실행자가 먼저 회수했다면 0 행이 되어, <b>둘이 동시에 제공자를 부르는 일이 없다</b>.
     * 무조건 UPDATE 로 바꾸면 임차 회수가 곧 동시 교환 창이 된다.
     *
     * @return 1 = 이 호출이 회수했다(재실행한다), 0 = 남이 먼저 가져갔다(진행 중으로 답한다)
     */
    @Modifying
    @Query(value = "UPDATE login_attempts SET claimed_at = :now, updated_at = :now "
            + "WHERE attempt_id = :attemptId AND status = 'PENDING' AND claimed_at = :expectedClaimedAt",
            nativeQuery = true)
    int reclaimExpired(
            @Param("attemptId") UUID attemptId,
            @Param("expectedClaimedAt") Instant expectedClaimedAt,
            @Param("now") Instant now);

    /**
     * 탈퇴자의 로그인 시도를 INVALIDATED 로 닫고 자격 digest·고정 서명 재료를 지운다
     * (GROMO-1801 · 계정 LLD §3 INVALIDATED · §4 · V65). user_id·session_id·시각만 폐기 표지로 남는다 —
     * 같은 시도의 재생은 digest 대조 «전에» 탈퇴 계정으로 판정돼 404 다.
     *
     * @param userId 탈퇴하는 유저
     * @param now    갱신 시각
     * @return 바뀐 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE login_attempts SET status = 'INVALIDATED', digest_key_id = NULL,"
            + " credential_digest = NULL, onboarding_complete = NULL, token_guest = NULL, auth_generation = NULL,"
            + " access_issued_at = NULL, access_expires_at = NULL, refresh_issued_at = NULL,"
            + " refresh_expires_at = NULL, refresh_jti = NULL, updated_at = :now WHERE user_id = :userId",
            nativeQuery = true)
    int invalidateAndEraseOfUser(@Param("userId") UUID userId, @Param("now") Instant now);
}

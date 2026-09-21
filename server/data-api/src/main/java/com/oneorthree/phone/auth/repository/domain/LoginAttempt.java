package com.oneorthree.phone.auth.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * 소셜 로그인 시도 한 건 — <b>「같은 시도를 두 번 실행하지 않는다」를 담는 원장</b>이다 (계정 LLD §3).
 *
 * <h2>왜 필요한가</h2>
 * 제공자 {@code authorizationCode} 는 <b>일회용</b>이다. 201 응답이 유실돼 앱이 재시도하면, 원장이
 * 없는 서버는 그 code 를 다시 교환하려 하고 제공자는 이미 소비된 code 를 거절한다 — 사용자에게는
 * 「로그인이 됐는데 안 됐다」로 보인다. 설령 교환에 성공하더라도 세션이 하나 더 생겨 앱이 RT 를
 * 모르는 세션이 남는다.
 *
 * <h2>토큰 원문을 담지 않는다</h2>
 * 재생에 필요한 것은 토큰 «문자열»이 아니라 그 문자열을 만들어 낸 <b>고정 서명 재료</b>다
 * (LLD §3 「원문 자격/원문 JWT 저장 금지」). HS256 서명은 결정적이라 같은 claims 에서 같은 문자열이
 * 나오므로, 재료만 남기고 재생 시 다시 서명하면 원본과 <b>바이트가 같은</b> 토큰이 된다. 이 표가
 * 유출돼도 토큰이 유출되지 않는다는 것이 이 선택의 전부다.
 *
 * <h2>digest 는 key id 와 «함께» 고정한다</h2>
 * 자격 digest 만 비교하면 「Business 의 digest 비밀이 교체됐다」와 「다른 자격이 왔다」가 구분되지
 * 않는다. LLD §3 은 전자를 {@code IDEMPOTENCY_KEY_REUSED} 로 판정하는 것을 <b>명시적으로 금지</b>
 * 한다 — 정상 사용자가 배포 한 번에 409 로 막히기 때문이다. 그래서 key id 를 먼저 대조한다.
 */
@Entity
@Table(name = "login_attempts")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LoginAttempt {

    /** 앱이 만든 {@code X-Login-Attempt-Id}. 이 값만으로는 어떤 결과도 얻을 수 없다. */
    @Id
    @Column(name = "attempt_id", nullable = false)
    private UUID attemptId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 24)
    private LoginAttemptStatus status;

    // 탈퇴로 INVALIDATED 된 시도는 digest 둘을 지운다(V65, GROMO-1801 · 계정 LLD §4).
    @Column(name = "digest_key_id", length = 64)
    private String digestKeyId;

    @Column(name = "credential_digest", length = 64)
    private String credentialDigest;

    @Column(name = "provider", nullable = false, length = 32)
    private String provider;

    @Column(name = "credential_kind", nullable = false, length = 32)
    private String credentialKind;

    @Column(name = "terms_version", nullable = false, length = 64)
    private String termsVersion;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "session_id")
    private UUID sessionId;

    @Column(name = "onboarding_complete")
    private Boolean onboardingComplete;

    @Column(name = "token_guest")
    private Boolean tokenGuest;

    @Column(name = "auth_generation")
    private Long authGeneration;

    @Column(name = "access_issued_at")
    private Instant accessIssuedAt;

    @Column(name = "access_expires_at")
    private Instant accessExpiresAt;

    @Column(name = "refresh_issued_at")
    private Instant refreshIssuedAt;

    @Column(name = "refresh_expires_at")
    private Instant refreshExpiresAt;

    @Column(name = "refresh_jti")
    private UUID refreshJti;

    // ── 계정 전환 재개 증거 (V101, GROMO-1992). 허용 모양은 ck_login_attempts_switch_state 의
    //    세 절과 같다 — 전환이 아닌 시도는 confirmed=false + 나머지 7열 null 이다.
    @Builder.Default
    @Column(name = "account_switch_confirmed", nullable = false)
    private boolean accountSwitchConfirmed = false;

    @Enumerated(EnumType.STRING)
    @Column(name = "switch_phase", length = 24)
    private LoginAttemptSwitchPhase switchPhase;

    @Column(name = "switch_source_user_id")
    private UUID switchSourceUserId;

    @Column(name = "switch_source_session_id")
    private UUID switchSourceSessionId;

    @Column(name = "switch_source_auth_generation")
    private Long switchSourceAuthGeneration;

    @Column(name = "switch_target_user_id")
    private UUID switchTargetUserId;

    @Column(name = "switch_target_social_account_id")
    private UUID switchTargetSocialAccountId;

    @Column(name = "switch_verified_at")
    private Instant switchVerifiedAt;

    @Column(name = "claimed_at", nullable = false)
    private Instant claimedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "recovery_expires_at", nullable = false)
    private Instant recoveryExpiresAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 확정 결과와 고정 서명 재료를 한 번에 박는다.
     *
     * <p>호출부가 {@code users} 잠금 아래에서 부르고, 이 쓰기와 세션 확정이 같은 트랜잭션이다 —
     * 결과만 커밋되고 세션이 없거나 그 반대인 상태를 만들지 않는다.
     *
     * <p>PENDING 에서만 간다 — 이미 COMPLETED 인 행의 「같은 결과」는 메서드 재호출이 아니라 저장
     * 결과 조회이고, INVALIDATED·REPREPARE_REQUIRED 는 종료라 다시 완료하지 않는다. 전환 시도는
     * {@link LoginAttemptSwitchPhase#GUEST_WITHDRAWN} 에서만 완료할 수 있다 — VERIFIED 에서
     * 완료하면 게스트 원천 정리 없는 전환 결과가 확정된다. 전환 증거는 recovery replay 검증을 위해
     * 완료 뒤에도 지우지 않는다(CHECK 둘째 절이 status=COMPLETED + evidence 를 허용한다).
     */
    public void complete(UUID userId, UUID sessionId, boolean onboardingComplete,
            LoginTokenMaterials materials, Instant now) {
        if (this.status != LoginAttemptStatus.PENDING) {
            throw new IllegalStateException(
                    "로그인 시도 완료는 PENDING 에서만 가능하다: " + this.status);
        }
        if (this.switchPhase != null
                && this.switchPhase != LoginAttemptSwitchPhase.GUEST_WITHDRAWN) {
            throw new IllegalStateException(
                    "전환 시도의 완료는 GUEST_WITHDRAWN 에서만 가능하다: " + this.switchPhase);
        }
        this.status = LoginAttemptStatus.COMPLETED;
        this.userId = userId;
        this.sessionId = sessionId;
        this.onboardingComplete = onboardingComplete;
        this.tokenGuest = materials.guest();
        this.authGeneration = materials.authGeneration();
        this.accessIssuedAt = materials.accessIssuedAt();
        this.accessExpiresAt = materials.accessExpiresAt();
        this.refreshIssuedAt = materials.refreshIssuedAt();
        this.refreshExpiresAt = materials.refreshExpiresAt();
        this.refreshJti = materials.refreshJti();
        this.completedAt = now;
    }

    /**
     * 죽은 실행자가 남긴 PENDING 의 실행권을 회수한다.
     *
     * <p>회수가 없으면 그 attempt id 는 영원히 「진행 중」이라 사용자가 같은 시도로는 다시 로그인할 수
     * 없다. 회수 뒤 재실행은 이미 소비된 code 를 다시 내밀 수 있지만, 그때는 제공자가 거절해 새
     * 인증을 요구하게 된다 — 갇히는 것보다 낫고, LLD §3 이 그 구간을 「별도 한계」로 인정한다.
     */
    public void reclaim(Instant now) {
        this.claimedAt = now;
    }

    /**
     * 전환 검증 증거를 박고 {@code VERIFIED} 로 전이한다.
     *
     * <p>전제는 PENDING + confirmed 다 — 아니면 불법 전이다. 같은 여섯 증거 값의 재호출은
     * 멱등이다: VERIFIED 재진입은 no-op 이고, GUEST_WITHDRAWN 재진입은 과거 단계를 되돌리지
     * 않고 no-op 이다. 하나라도 다른 증거로 재진입하면 「같은 시도의 다른 전환」이라
     * fail-closed 로 거절한다.
     */
    public void verifySwitch(UUID sourceUserId, UUID sourceSessionId, long sourceAuthGeneration,
            UUID targetUserId, UUID targetSocialAccountId, Instant verifiedAt) {
        Objects.requireNonNull(sourceUserId, "sourceUserId");
        Objects.requireNonNull(sourceSessionId, "sourceSessionId");
        Objects.requireNonNull(targetUserId, "targetUserId");
        Objects.requireNonNull(targetSocialAccountId, "targetSocialAccountId");
        Objects.requireNonNull(verifiedAt, "verifiedAt");
        if (sourceAuthGeneration < 0) {
            throw new IllegalArgumentException("source auth generation 은 0 이상이어야 한다");
        }
        if (this.status != LoginAttemptStatus.PENDING || !this.accountSwitchConfirmed) {
            throw new IllegalStateException(
                    "전환 검증은 PENDING + confirmed 시도에서만 가능하다: status=" + this.status
                            + " confirmed=" + this.accountSwitchConfirmed);
        }
        if (this.switchPhase == null) {
            this.switchSourceUserId = sourceUserId;
            this.switchSourceSessionId = sourceSessionId;
            this.switchSourceAuthGeneration = sourceAuthGeneration;
            this.switchTargetUserId = targetUserId;
            this.switchTargetSocialAccountId = targetSocialAccountId;
            this.switchVerifiedAt = verifiedAt;
            this.switchPhase = LoginAttemptSwitchPhase.VERIFIED;
            return;
        }
        if (sameSwitchEvidence(sourceUserId, sourceSessionId, sourceAuthGeneration,
                targetUserId, targetSocialAccountId, verifiedAt)) {
            return;
        }
        throw new IllegalStateException(
                "같은 시도에 다른 전환 증거가 들어왔다: " + this.switchPhase);
    }

    /**
     * source 게스트가 정리돼 {@code GUEST_WITHDRAWN} 로 전이한다 — PENDING + VERIFIED 에서만.
     *
     * <p>재호출은 no-op 이다. 증거 열은 건드리지 않는다 — 완료·재생 판정과 종료 표지 비교가 그
     * 값들을 그대로 요구한다.
     */
    public void markGuestWithdrawn() {
        if (this.status == LoginAttemptStatus.PENDING
                && this.switchPhase == LoginAttemptSwitchPhase.GUEST_WITHDRAWN) {
            return;
        }
        if (this.status != LoginAttemptStatus.PENDING
                || this.switchPhase != LoginAttemptSwitchPhase.VERIFIED) {
            throw new IllegalStateException(
                    "GUEST_WITHDRAWN 전이는 PENDING + VERIFIED 에서만 가능하다: status="
                            + this.status + " phase=" + this.switchPhase);
        }
        this.switchPhase = LoginAttemptSwitchPhase.GUEST_WITHDRAWN;
    }

    private boolean sameSwitchEvidence(UUID sourceUserId, UUID sourceSessionId,
            long sourceAuthGeneration, UUID targetUserId, UUID targetSocialAccountId,
            Instant verifiedAt) {
        return Objects.equals(this.switchSourceUserId, sourceUserId)
                && Objects.equals(this.switchSourceSessionId, sourceSessionId)
                && Objects.equals(this.switchSourceAuthGeneration, sourceAuthGeneration)
                && Objects.equals(this.switchTargetUserId, targetUserId)
                && Objects.equals(this.switchTargetSocialAccountId, targetSocialAccountId)
                && Objects.equals(this.switchVerifiedAt, verifiedAt);
    }

    /**
     * 복구 창이 끝났거나 주체가 폐기됐다. 종료 상태이며 재준비·재생이 모두 닫힌다. 재호출은 no-op 이다.
     *
     * <p>전환 시도라면 여섯 증거 열(source/target 식별자 5개 + {@code switch_verified_at})을
     * 지우고 {@code switch_phase}·{@code account_switch_confirmed} 만 종료 분류 표지로 남긴다 —
     * CHECK 셋째 절이 요구하는 모양이다.
     */
    public void invalidate() {
        if (this.status == LoginAttemptStatus.INVALIDATED) {
            return;
        }
        this.status = LoginAttemptStatus.INVALIDATED;
        if (this.switchPhase != null) {
            this.switchSourceUserId = null;
            this.switchSourceSessionId = null;
            this.switchSourceAuthGeneration = null;
            this.switchTargetUserId = null;
            this.switchTargetSocialAccountId = null;
            this.switchVerifiedAt = null;
        }
    }
}

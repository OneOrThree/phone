package com.oneorthree.phone.auth.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
import java.util.UUID;

/**
 * 로그인 세션 한 건. RT 해시·bootstrap 자격·폐기 상태의 정본이다.
 *
 * <p>개별 로그아웃은 이 행만 폐기한다. 사용자 세대와 알림 서버의 기기 소유권 버전은 별도 축이며,
 * 상태를 변경하는 호출자는 사용자 행을 먼저 잠가 로그인·로그아웃·탈퇴와 직렬화한다.
 */
@Entity
@Table(name = "auth_sessions")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class AuthSession {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** 이 세션이 현재 인정하는 RT 의 SHA-256 hex. 회전 때 갈아끼운다. */
    // 탈퇴가 폐기 tombstone 에서 지운다(V65, GROMO-1801). 활성 세션은 항상 non-null 이다.
    @Column(name = "refresh_token_hash", length = 64)
    private String refreshTokenHash;

    /**
     * {@code deviceBootstrap} 자격의 SHA-256 hex — <b>원문은 저장하지 않는다</b>.
     *
     * <p>저장하면 DB 유출이 곧 「소유권 이전 자격 유출」이다. 현 앱은 이 값을 보내지 않으므로
     * (등록 요청 본문이 {@code {deviceToken}} 뿐이다) 롤아웃 기간 동안 {@code null} 을 허용한다.
     */
    @Column(name = "bootstrap_nonce_hash", length = 64)
    private String bootstrapNonceHash;

    /**
     * fencing 값 (㋨) — 알림 서버가 자기 tombstone 과 <b>원자 대조</b>해 이 값보다 오래된 소유권
     * 변경을 거부한다. 유저 축 aggregate 행 잠금 아래 발급되므로 번호 순서가 곧 커밋 순서다(㊸).
     */
    @Column(name = "session_epoch", nullable = false)
    private long sessionEpoch;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoke_reason", length = 30)
    private String revokeReason;

    /** 로그아웃이 확정한 원 RT 만료. 재시도 시 종료 증거와 대조한다. */
    @Column(name = "logout_refresh_expires_at")
    private Instant logoutRefreshExpiresAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 폐기 — <b>이미 폐기된 행은 시각을 덮지 않는다</b>. 덮으면 「전 기기 로그아웃이 먼저 끊은 세션을
     * 뒤늦게 온 개별 로그아웃이 다시 표시」해 폐기 사유가 뒤바뀐다.
     *
     * @param at     폐기 시각
     * @param reason 폐기 사유 — 관측용. 판정에는 {@code revokedAt} 만 쓴다
     * @return 이번 호출이 실제로 폐기했으면 {@code true}
     */
    public boolean revoke(Instant at, String reason) {
        if (this.revokedAt != null) {
            return false;
        }
        this.revokedAt = at;
        this.revokeReason = reason;
        return true;
    }

    /** 현재 세션의 종료 증거와 fencing 값을 같은 변경으로 확정한다. */
    public void revokeForLogout(Instant at, Instant refreshExpiresAt, long epoch) {
        if (!isActive()) {
            throw new IllegalStateException("이미 종료된 세션의 증거를 바꿀 수 없습니다.");
        }
        this.logoutRefreshExpiresAt = refreshExpiresAt;
        this.sessionEpoch = epoch;
        revoke(at, "LOGOUT");
    }

    /**
     * @return 아직 살아 있는 세션인가
     */
    public boolean isActive() {
        return this.revokedAt == null;
    }
}

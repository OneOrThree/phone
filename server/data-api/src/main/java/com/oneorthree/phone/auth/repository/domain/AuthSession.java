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
 * 로그인 세션 한 건 — <b>세션 축</b>이다 (A22 ㋣ · ㋞ · ㋨).
 *
 * <h2>왜 users.refresh_token_hash 로는 안 되는가</h2>
 * 현행은 유저 행에 RT 해시가 <b>하나</b>뿐이라 세션이 하나라는 전제다. 그 전제에서는
 * ① B 기기 로그인이 A 기기의 세션을 무효화하고, ② 한 기기 로그아웃이 전 세션을 지운다.
 * 「개별 기기 로그아웃은 그 세션만, 전 기기 로그아웃·탈퇴만 전부」라는 계약은 세션마다 행이 있어야
 * 표현된다.
 *
 * <h2>축이 셋이라는 것</h2>
 * 유저 축({@code users.auth_generation}: 탈퇴·전 기기 로그아웃) · 기기 축({@code ownershipVersion}:
 * 알림 서버 소유) · <b>세션 축(이 행)</b> 은 서로 다른 사건을 담는다(㋞). 개별 기기 로그아웃은
 * 유저도 기기도 아닌 <b>「세션이 끝나는」</b> 사건이라, 앞의 둘 어디에도 자리가 없다.
 *
 * <h2>기존 경로를 깨지 않는다</h2>
 * 구 RT 에는 {@code sessionId} 가 없다(㋪). 그래서 이 테이블은 {@code users.refresh_token_hash}
 * 경로와 <b>병행</b>한다 — 로그인·회전이 세션 행을 함께 쓰되, 세션 행이 없는 구 RT 도 기존대로
 * 동작한다. 곧장 전환하면 최대 RT 수명 동안 구 토큰을 든 사용자가 전부 끊기고, 게스트에게 그것은
 * 계정 소실이다. <b>다만 세션 행이 있는 RT 는 이 행이 판정·회전의 권위다</b> — 유저 행의 해시를
 * 먼저 보면 B 기기 로그인이 그 값을 덮는 순간 A 기기가 통째로 끊긴다(GROMO-1659 codex R10).
 *
 * <h2>회전·자격 재발급은 이 엔티티에 쓰지 않는다</h2>
 * 회전 경로는 세션을 <b>락 없이</b> 읽으므로, 그 스냅샷으로 dirty checking 을 하면 동시 회전 둘이 다
 * 성공하거나 그 사이 커밋된 폐기를 되살린다. {@code refreshTokenHash}·{@code sessionEpoch}·
 * {@code bootstrapNonceHash} 는 {@code AuthSessionRepository.rotateIfCurrent} 의 조건부 UPDATE 로만
 * 바뀐다. {@link #revoke} 만 엔티티 쓰기인데, 호출부가 {@code users} 행 배타 락 아래에서 부르기
 * 때문이다.
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
    @Column(name = "refresh_token_hash", nullable = false, length = 64)
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

    /** 신규 RT 전용 로그아웃이 확정한 원 RT 만료. null인 legacy 종료는 신규 재생 증명이 아니다. */
    @Column(name = "logout_refresh_expires_at")
    private Instant logoutRefreshExpiresAt;

    /**
     * 구 RT 를 승격해 만든 행인가 (㋪). 백필 행에는 bootstrap nonce 가 없어 <b>무토큰 소유권 이전</b>
     * 경로를 열 수 없다 — 「행이 있다」만으로 그 경로를 열면 구 앱 전체가 그 예외를 통과한다.
     */
    @Column(nullable = false)
    @Builder.Default
    private boolean legacy = false;

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

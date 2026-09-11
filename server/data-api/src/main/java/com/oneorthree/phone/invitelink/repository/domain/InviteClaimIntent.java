package com.oneorthree.phone.invitelink.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;

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
import java.util.UUID;

/**
 * claim 의도 한 건 — <b>{@code 202} 를 줄 수 있는 유일한 근거</b> (A22 ㊄ · ㊺).
 *
 * <p>정지 창의 claim 은 거절이 아니라 <b>대기</b>다. 앱은 전역 15초 예산을 넘기면 다음 로그인까지
 * 재시도하지 않으므로({@code claimStoredInviteAttribution}), 거절로 접으면 그 귀속은 영영 사라진다.
 * 그래서 동기 확정이 끝나지 않아도 <b>이 행이 커밋된 뒤에만</b> 202 를 준다.
 *
 * <h2>왜 outbox 행이 아닌가</h2>
 * outbox 봉투는 전달 대상이 하나 이상이어야 한다(아무 데도 안 가는 봉투는 유실과 구분되지 않는다).
 * 그런데 claim 의도는 위성으로 나가는 명령이 아니다 — Data 가 링크 서버에 「claim 을 만들어라」고
 * HTTP 로 부르는 것은 단방향 규칙(§3) 위반이고, 동시에 「확정 순서는 Data 가 갖는다」(㋟)를 뒤집는다.
 * 그래서 이 큐는 Data 소유 상태로 남고, 재개는 <b>Business 가</b> 링크 → Data confirm 순서를 다시 밟는다.
 */
@Entity
@Table(name = "invite_claim_intents")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class InviteClaimIntent {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 12)
    private String slug;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private InviteClaimIntentStatus status = InviteClaimIntentStatus.PENDING;

    /**
     * 결정적 사건 키 — {@code link.claimIntent:<userId>:<SHA-256(정규화된 멱등 키)>} 다.
     *
     * <p><b>slug 가 들어가지 않는다.</b> 키의 주인은 앱이고, 같은 키로 다른 slug 가 오면 그건 재시도가
     * 아니라 «키를 재사용한 별개 명령»이다 — 그래서 그 조합은 키로 접히지 않고 {@code
     * IDEMPOTENCY_KEY_CONFLICT}(409) 로 거절된다. slug 는 이 행에 저장해 두고 대조에만 쓴다.
     *
     * <p><b>{@code (유저, slug)} 를 키로 쓰지 않는 이유</b>: 그러면 한 번 종결된 조합으로는 새 의도가
     * 영영 생기지 않는다. 클릭 귀속이 뒤늦게 잡혀 같은 slug 를 다시 claim 하는 것은 정상 경로인데,
     * 종결된 행이 그대로 재생되면 아무도 이어받지 않는 202 가 나간다(귀속 유실). 요청 키마다 행을
     * 나누면 같은 키의 재시도는 그대로 접히고, 새 키는 «새 PENDING 의도»를 받는다.
     *
     * <p>길이는 {@code 17 + 36 + 1 + 64 = 118} 로 상한 200 안이다 — 새 컬럼·확장이 필요 없다.
     */
    @Column(name = "event_id", nullable = false, length = 200)
    private String eventId;

    /**
     * 이 의도를 만든 멱등 키 — 재개 실행자가 <b>같은 키로</b> 링크 pending·Data confirm 을 재생한다(㉼).
     *
     * <p>새 키를 만들면 재개가 별개 명령이 되어, 이미 확정된 귀속을 한 번 더 집계한다.
     */
    @Column(name = "idempotency_key", nullable = false, length = 200)
    private String idempotencyKey;

    /** 유저 축 aggregate 잠금 아래 발급된 값. 명령 응답 봉투의 {@code version} 이다(㉵). */
    @Column(nullable = false)
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    /**
     * 선점 리스의 소유자 — 관측용이다. 판정은 {@link #leaseToken} 과 {@link #leaseExpiresAt} 이 한다.
     */
    @Column(name = "lease_owner", length = 80)
    private String leaseOwner;

    /**
     * 펜싱 토큰. 리스가 만료돼 남이 재선점한 뒤 옛 실행자가 뒤늦게 완료를 보고하면 토큰이 달라
     * 아무것도 갱신되지 않는다 — 「낡은 완료 표시」를 거부하는 유일한 장치다.
     */
    @Column(name = "lease_token")
    private UUID leaseToken;

    @Column(name = "lease_expires_at")
    private Instant leaseExpiresAt;

    @Column(name = "attempt_count", nullable = false)
    @Builder.Default
    private int attemptCount = 0;

    /** 백오프 — 이 시각 전에는 다시 집지 않는다. */
    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    @Column(name = "last_error")
    private String lastError;

    /**
     * 이 의도를 끝낸 리스의 토큰. 같은 토큰의 재보고는 멱등 성공이고, 다른 토큰은 낡은 보고다.
     *
     * <p>리스가 걸려 있지 않은 채 끝난 경우에만 {@code null} 이다 — 리스를 쥔 실행자가 확정을
     * 몰고 왔다면 {@link #consume(Instant)} 가 <b>그 토큰을 그대로 물려받는다</b>. 물려받지 않으면
     * 정상 완주한 실행자의 완료 보고가 「낡은 보고」로 거절된다(아래 참고).
     */
    @Column(name = "completed_by_lease_token")
    private UUID completedByLeaseToken;

    /**
     * 소비 완료 표시 — <b>이미 종결된 의도는 덮지 않는다</b>. 덮으면 완료 시각이 뒤로 밀려
     * 재개가 실제로 언제 끝났는지 알 수 없게 된다.
     *
     * <p><b>현재 리스의 토큰을 완료 토큰으로 물려받는다.</b> 확정은 재개 실행자가 몰고 올 수도 있고
     * (lease → 링크 잠정 → Data 확정) 그때 확정이 이 의도를 닫는데, 완료 토큰을 {@code null} 로 두면
     * 바로 뒤에 오는 그 실행자의 «자기 리스» 완료 보고가 {@code CLAIM_INTENT_LEASE_STALE} 로 거절된다
     * — 재개가 성공했는데 실패로 세어 「미완료 0」 gate 를 거짓으로 막는다. 반대로 토큰을 이어받으면
     * 펜싱은 그대로다: 리스가 만료돼 남이 재선점한 뒤 뒤늦게 보고하는 옛 실행자의 토큰은 여전히
     * 현재 완료 토큰과 달라 거절된다.
     *
     * @param at 완료 시각
     * @return 이번 호출이 실제로 종결했으면 {@code true}
     */
    public boolean consume(Instant at) {
        return complete(at, this.leaseToken);
    }

    /**
     * 재개 실행자의 완료 보고로 종결한다.
     *
     * @param at         완료 시각
     * @param leaseToken 끝낸 리스의 펜싱 토큰. 동기 확정이면 {@code null}
     * @return 이번 호출이 실제로 종결했으면 {@code true}
     */
    public boolean complete(Instant at, UUID leaseToken) {
        if (this.status != InviteClaimIntentStatus.PENDING) {
            return false;
        }
        this.status = InviteClaimIntentStatus.CONSUMED;
        this.consumedAt = at;
        this.completedByLeaseToken = leaseToken;
        this.leaseOwner = null;
        this.leaseToken = null;
        this.leaseExpiresAt = null;
        return true;
    }

    /**
     * 재개 실행자가 이 의도를 선점한다.
     *
     * @param owner     실행자 식별자
     * @param token     펜싱 토큰
     * @param expiresAt 리스 만료
     */
    public void lease(String owner, UUID token, Instant expiresAt) {
        this.leaseOwner = owner;
        this.leaseToken = token;
        this.leaseExpiresAt = expiresAt;
        this.attemptCount = this.attemptCount + 1;
    }

    /**
     * 실패를 기록하고 리스를 놓는다 — <b>행을 지우지 않는다</b>. 최종 재시도 기간·고갈 처리는 A18
     * 보류라, 여기서 폐기하면 보류된 정책을 코드가 먼저 정해 버린다.
     *
     * @param nextAt 다음 시도 시각
     * @param error  마지막 오류 요약
     */
    public void releaseWithFailure(Instant nextAt, String error) {
        this.leaseOwner = null;
        this.leaseToken = null;
        this.leaseExpiresAt = null;
        this.nextAttemptAt = nextAt;
        this.lastError = error;
    }

    /**
     * @param token 보고자가 든 펜싱 토큰
     * @return 그 토큰이 현재 리스의 것인가. {@code null} 리스는 누구의 것도 아니다
     */
    public boolean holdsLease(UUID token) {
        return this.leaseToken != null && this.leaseToken.equals(token);
    }

    /**
     * 이 의도가 <b>이미 끝났는가</b> — 적재 응답의 {@code completed} 다.
     *
     * <p>같은 요청 키로 다시 온 claim 은 이 값이 {@code true} 면 더 밟을 것이 없다. Business 가
     * 이걸 보고 «내구 큐가 이어받는다»는 뜻의 202 를 주지 않는다 — 종결된 의도는 재개 sweep
     * ({@code status='PENDING'})에 잡히지 않으므로 그 202 는 아무도 이어받지 않는 거짓말이 된다.
     *
     * @return {@code CONSUMED} 또는 {@code ABANDONED} 면 {@code true}
     */
    public boolean isSettled() {
        return this.status != InviteClaimIntentStatus.PENDING;
    }

    /**
     * 정본 판정으로 종결 — 실패가 아니다.
     *
     * <p>{@link #consume(Instant)} 와 같은 이유로 <b>현재 리스의 토큰을 완료 토큰으로 물려받는다</b> —
     * 이 종결이 리스를 쥔 실행자와 겹쳤을 때 그 실행자의 완료 보고를 낡은 보고로 오인하지 않기 위해서다.
     *
     * @param at 종결 시각
     * @return 이번 호출이 실제로 종결했으면 {@code true}
     */
    public boolean abandon(Instant at) {
        if (this.status != InviteClaimIntentStatus.PENDING) {
            return false;
        }
        this.status = InviteClaimIntentStatus.ABANDONED;
        this.consumedAt = at;
        this.completedByLeaseToken = this.leaseToken;
        this.leaseOwner = null;
        this.leaseToken = null;
        this.leaseExpiresAt = null;
        return true;
    }
}

package com.oneorthree.phone.invitelink.repository.domain;

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

import java.time.Instant;
import java.util.UUID;

/**
 * 링크의 <b>잠정 claim</b> 을 유효로 만드는 확정 근거 (A22 ㋟ · ㋛ 취소선).
 *
 * <p>{@code claimSeq} 는 링크 서버의 <b>판정 순서</b>일 뿐 기록 순서가 아니다 — 판정 10 을 받은
 * 잠정 claim 이 revoke 11 뒤에 기록되면 순서 비교만으로는 살아남는다. 그래서 유효 판정은 Data 가
 * <b>멤버십 락 아래</b> 남긴 이 행이고, 전달은 {@code link.claimConfirmed} outbox + relay 다.
 *
 * <p>{@code id} 가 곧 명령 payload 의 {@code proof.confirmationId} 이고 {@code committedAt} 이
 * {@code proof.committedAt} 이다 — 링크 서버가 「무엇을 근거로 유효해졌는가」를 자기 원장에 남긴다.
 */
@Entity
@Table(name = "invite_claim_confirmations")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class InviteClaimConfirmation {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /** 링크 서버가 만든 잠정 claim 의 id. 같은 claim 이 두 번 확정되지 않게 UNIQUE 다. */
    @Column(name = "claim_id", nullable = false)
    private UUID claimId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "group_id", nullable = false)
    private UUID groupId;

    @Column(name = "inviter_id", nullable = false)
    private UUID inviterId;

    @Column(nullable = false, length = 12)
    private String slug;

    /** 확정 <b>시점</b>의 멤버십 세대 — 링크 서버가 구세대 명령을 거르는 기준이다. */
    @Column(name = "membership_epoch", nullable = false)
    private long membershipEpoch;

    /** 확정 <b>시점</b>의 전이 순서 — 링크 서버가 역순 적용을 거르는 기준이다(㋥). */
    @Column(name = "transition_seq", nullable = false)
    private long transitionSeq;

    /**
     * 이 확정이 만든 봉투의 {@code eventId} — <b>claim 단위 재생</b>의 근거다.
     *
     * <p>멱등 키는 앱이 소유하므로 원 요청과 재개 실행자가 서로 다른 키를 들 수 있다. 그때 키 단위
     * 멱등만으로는 같은 claim 이 두 번 확정돼, 링크 원장에 같은 귀속이 두 번 반영된다.
     */
    @Column(name = "event_id", nullable = false, length = 200)
    private String eventId;

    /** 그 봉투의 순서 version — 재생 응답이 원 응답과 같아야 한다(㉵). */
    @Column(nullable = false)
    private long version;

    @Column(name = "committed_at", nullable = false)
    private Instant committedAt;

    /**
     * 봉투의 순서 version 을 박는다 — 저장 «뒤에» 부른다.
     *
     * <p>순서가 이런 이유: {@code proof.confirmationId} 가 이 행의 PK 라서 봉투를 적기 전에 저장이
     * 끝나 있어야 하는데, version 은 그 봉투가 발급하기 때문이다.
     *
     * @param version {@code append} 가 돌려준 값
     */
    public void applyEnvelopeVersion(long version) {
        this.version = version;
    }
}

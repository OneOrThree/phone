package com.oneorthree.phone.auth.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 게스트 기기 점유 한 건 — <b>「같은 기기의 재시도가 계정을 하나 더 만들지 않는다」를 담는 원장</b>
 * 이다 (GROMO-2036, V87).
 *
 * <h2>왜 필요한가</h2>
 * 게스트 발급은 호출 한 번마다 {@code users} 행이 하나 생긴다. 201 응답이 유실돼 앱이 재시도하면
 * 같은 사람에게 계정이 둘 생기고, 앱은 그중 하나의 토큰만 들고 나머지는 주인 없는 행으로 남는다.
 * {@link LoginAttempt} 가 소셜 로그인에 대해 하는 일을 게스트 축에서 하는 표다.
 *
 * <h2>기기 식별자 원문을 담지 않는다</h2>
 * {@code deviceDigest} 는 Business 가 자기 비밀로 계산한 keyed HMAC 이다(계정 LLD §3 「앱이 제출한
 * digest 를 자격으로 수락하지 않는다」). Data 는 원 기기 식별자를 본 적이 없고, 이 표가 유출돼도
 * 기기 식별자는 나오지 않는다.
 *
 * <h2>복구 창이 «있는» 이유</h2>
 * 창 안에서 같은 digest 는 같은 유저의 새 세션을 받는다. 무기한이면 기기 식별자가 게스트 계정의
 * <b>영구 bearer 자격</b>이 되는데, 계정 LLD §3 은 「게스트의 복구창 밖 처리에는 아직 승인된 대체
 * 복구 수단이 없다」(Q06)고 못 박는다 — 그 미결을 여기서 임의로 확정하지 않는다.
 */
@Entity
@Table(name = "guest_device_claims")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GuestDeviceClaim {

    /** keyed HMAC-SHA256 hex 64자. 기기 식별자 원문이 아니다. */
    @Id
    @Column(name = "device_digest", nullable = false, length = 64)
    private String deviceDigest;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "claimed_at", nullable = false)
    private Instant claimedAt;

    @Column(name = "recovery_expires_at", nullable = false)
    private Instant recoveryExpiresAt;

    /** 이 시각에 점유가 아직 같은 유저를 재생해 주는가. */
    public boolean isRecoverableAt(Instant now) {
        return now.isBefore(recoveryExpiresAt);
    }
}

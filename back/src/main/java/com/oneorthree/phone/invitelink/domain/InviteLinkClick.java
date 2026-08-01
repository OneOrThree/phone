package com.oneorthree.phone.invitelink.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 초대 링크 클릭 한 건 — 그리고 그 클릭이 겪는 상태 전이 전부.
 *
 * <p>클릭 → 매치(설치 기기와 연결) → claim(유저와 연결)을 별도 install 테이블 없이 이 한 행이 가진다.
 * 상태를 한 행에 모아두면 "이 클릭이 어디까지 갔나"가 조인 없이 읽히고, 매치 소진이 곧 이 행의 UPDATE 라
 * 원자성 확보가 단순해진다.
 *
 * <p><b>원본 IP 는 저장하지 않는다.</b> {@code ipHash} 는 SHA-256(ip + LINK_IP_SALT) hex 64자다.
 */
@Entity
@Table(name = "invite_link_clicks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InviteLinkClick {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "link_id", nullable = false)
    private UUID linkId;

    /** SHA-256(ip + salt) hex 64자 — 매치의 fingerprint 한 축. 원본 IP 는 어디에도 남기지 않는다. */
    @Column(name = "ip_hash", nullable = false, length = 64)
    private String ipHash;

    /** 'ios' | 'android' | 'other'. 매치의 나머지 한 축. */
    @Column(nullable = false, length = 16)
    private String os;

    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @Column(name = "clicked_at", nullable = false)
    private Instant clickedAt;

    /** 매치 소진 플래그. true 가 되면 다시는 매치되지 않는다(재설치 반복 매치 방어선). */
    @Column(nullable = false)
    private boolean matched;

    @Column(name = "matched_at")
    private Instant matchedAt;

    @Column(name = "matched_device_id", length = 64)
    private String matchedDeviceId;

    /** GA4 앱스트림 결합용 Firebase app_instance_id. 앱이 못 구하면 null 일 수 있다. */
    @Column(name = "app_instance_id", length = 64)
    private String appInstanceId;

    @Column(name = "claimed_user_id")
    private UUID claimedUserId;

    @Column(name = "claimed_at")
    private Instant claimedAt;

    public InviteLinkClick(UUID linkId, String ipHash, String os, String userAgent) {
        this.linkId = linkId;
        this.ipHash = ipHash;
        this.os = os;
        this.userAgent = userAgent;
        this.clickedAt = Instant.now();
        this.matched = false;
    }

    /** 설치 기기와 연결하며 클릭을 소진한다. 호출측이 비관적 락 안에서 부르는 것이 전제다. */
    public void markMatched(String deviceId, String appInstanceId) {
        this.matched = true;
        this.matchedAt = Instant.now();
        this.matchedDeviceId = deviceId;
        this.appInstanceId = appInstanceId;
    }

    /**
     * 가입/로그인한 유저를 이 클릭에 붙인다 — 최초 1회만.
     *
     * <p>이미 claim 됐거나 초대자 본인이면 아무것도 하지 않고 {@code false}(셀프 초대 방지·멱등).
     */
    public boolean claim(UUID userId, UUID inviterId) {
        if (claimedUserId != null || userId.equals(inviterId)) {
            return false;
        }
        this.claimedUserId = userId;
        this.claimedAt = Instant.now();
        return true;
    }
}

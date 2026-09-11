package com.oneorthree.phone.invitelink.repository.domain;

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

    /**
     * 랜딩 클릭 1건을 기록한다. 생성 시점에는 아직 아무 기기·유저와도 연결되지 않은
     * ({@code matched=false}) 상태다.
     *
     * @param linkId 클릭된 초대 링크
     * @param ipHash 클라이언트 IP 의 솔트 해시 — <b>원문 IP 는 저장하지 않는다</b>
     * @param os 매칭 축으로 쓰는 기기 OS
     * @param userAgent 봇 판별·디버깅용 원문. 외부 입력이므로 이 값으로 분기하는 로직을 늘리지 않는다
     */
    public InviteLinkClick(UUID linkId, String ipHash, String os, String userAgent) {
        this.linkId = linkId;
        this.ipHash = ipHash;
        this.os = os;
        this.userAgent = userAgent;
        this.clickedAt = Instant.now();
        this.matched = false;
    }

    /**
     * 설치 기기와 연결하며 클릭을 소진한다.
     *
     * <p><b>전제: 호출측이 비관적 락을 쥐고 있어야 한다.</b> 이 메서드 자체는 아무것도 검사하지 않으므로,
     * 락 없이 부르면 동시 요청이 같은 클릭을 둘 다 소진해 한 번의 클릭이 두 기기에 매치된다.
     * 유일한 정상 호출 경로는
     * {@code InviteLinkClickRepository.findFirstByIpHashAndOsAndMatchedFalse…}(PESSIMISTIC_WRITE)
     * 로 잠근 행을 넘겨받는 {@code InviteLinkMatchService.match} 다. 새 호출부를 만들지 말 것.
     *
     * @param deviceId 이 클릭을 가져간 설치 식별자. 같은 기기의 재시도를 멱등으로 만드는 키가 된다
     * @param appInstanceId GA4 앱스트림 결합용 Firebase 식별자. 앱이 못 구하면 null 이며,
     *                      그 경우 이 설치의 퍼널이 GA4 에서 이어지지 않는다
     */
    public void markMatched(String deviceId, String appInstanceId) {
        this.matched = true;
        this.matchedAt = Instant.now();
        this.matchedDeviceId = deviceId;
        this.appInstanceId = appInstanceId;
    }

    /**
     * 가입/로그인한 유저를 이 클릭에 붙인다 — 최초 1회만.
     *
     * <p>이미 claim 됐거나(탈퇴 후 귀속만 익명화된 경우 포함) 초대자 본인이면 아무것도 하지 않고 {@code false}(셀프 초대 방지·멱등).
     *
     * <p><b>전제: {@link #markMatched} 와 같다 — 호출측이 비관적 락을 쥐고 있어야 한다.</b> 락 없이
     * 부르면 동시 claim 두 건이 같은 행을 덮어써 "최초 1회" 가 lost update 로 뒤집힌다. 유일한 정상
     * 호출 경로는 {@code findFirstByLinkIdAndMatchedTrueAndClaimedUserIdIsNull…}(PESSIMISTIC_WRITE)
     * 로 잠근 행을 넘겨받는 {@code InviteLinkMatchService.claim} 이다.
     *
     * @param userId 초대를 수락한 유저
     * @param inviterId 링크 발급자. 같으면 셀프 초대라 거절한다 — 자기 링크를 자기가 타서
     *                  보상을 받는 경로를 막는 유일한 검사다
     * @return true = 이번 호출이 이 클릭을 선점해 유저를 붙였다(보상 지급의 근거),
     *         false = 이미 남이 claim 했거나 셀프 초대다. <b>예외가 아니므로 호출부가 값을 안 보면
     *         중복 보상이 나간다</b>
     */
    public boolean claim(UUID userId, UUID inviterId) {
        if (claimedUserId != null || claimedAt != null || userId.equals(inviterId)) {
            return false;
        }
        this.claimedUserId = userId;
        this.claimedAt = Instant.now();
        return true;
    }
}

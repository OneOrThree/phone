package com.oneorthree.phone.group.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
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
 * 그룹 챌린지 내기 <b>설정</b> — 챌린지당 1행(1:1, GROMO-1262 2계층 재편).
 *
 * <p>재편 전에는 이 테이블의 행 하나가 (챌린지, 날짜)의 판이자 정산 단위였다. 이제 판(참가·판정·
 * 정산의 단위)은 {@link GroupChallengeBetSession}(회차)이고, 이 행은 "이 챌린지에 내기가 걸려
 * 있고 참가비는 얼마인가"라는 <b>설정</b>만 담는다. "개설"이라는 행위는 소멸했다 — 회차는 설정에서
 * 파생될 뿐 누가 열지 않는다.
 *
 * <p>{@code stake} 는 회차 개설 시점에 회차 행으로 <b>박제</b>되므로(GROMO-1263), 이 값이 바뀌어도
 * 이미 열린 회차·정산 이력은 흔들리지 않는다. 구 API 브리지(N36) 동안에는 레거시 개설 경로가
 * 설정 stake 를 갱신할 수 있다 — to-be(불변)로의 잠금은 신 API 전환(B4~) 시점의 몫이다.
 */
@Entity
@Table(name = "group_challenge_bets",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_group_challenge_bets_challenge",
                columnNames = "challenge_id"))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeBet {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /**
     * 조회가 항상 그룹 스코프로 들어오므로(그룹원 검증) 챌린지를 거치지 않고 바로 걸러내려 비정규화해 둔다.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "challenge_id", nullable = false)
    private GroupChallenge challenge;

    /** 1인 참가비 — 회차 개설 시점에 회차로 박제된다. 서버 허용 범위(1~3000, V40 CHECK)만 저장된다. */
    @Column(nullable = false)
    private int stake;

    /**
     * 내기 켜짐 여부. 생성 시 결정 — false 로 되돌리는 경로가 없다(끄려면 챌린지를 삭제하고
     * 내기 없이 재생성한다, policy §A7·N26).
     */
    @Column(nullable = false)
    @Builder.Default
    private boolean enabled = true;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    /**
     * 레거시 개설 브리지(N36) 전용 stake 갱신 — 구앱은 매일 개설하며 참가비를 새로 고르므로,
     * 설정이 이미 있으면 최신 선택값으로 맞춘다. 회차가 자기 stake 를 박제하므로 과거·현재 회차의
     * 돈 계산에는 영향이 없다. 호출부는 챌린지 행 배타 락 아래에서만 부른다(개설 경로 직렬화).
     */
    public void updateStakeForLegacyBridge(int stake) {
        this.stake = stake;
    }
}

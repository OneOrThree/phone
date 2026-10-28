package com.oneorthree.phone.focus.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
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
import java.time.LocalDate;
import java.util.UUID;

/**
 * 세션의 UTC 날짜별 집중 보상 적립 합계.
 *
 * <p>분당 적립이 확정한 수량을 보관해 하루 상한과 섬 기여 집계의 근거로 사용한다.
 * 소속 상실·포기로 정산 행이 생기지 않아도 이미 적립된 수량은 유지한다.
 *
 * <p>적립일의 UTC 경계는 집중 일 집계의 KST 경계와 구분한다. 사용자·섬 정보는 상세와 조인하고,
 * 탈퇴 시 상세의 사용자 참조를 끊으면 사용자별 조회에서도 제외된다.
 */
@Entity
@Table(name = "focus_reward_accruals", uniqueConstraints = @UniqueConstraint(
        name = "focus_reward_accruals_session_day_uk",
        columnNames = {"session_id", "accrued_on"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusRewardAccrual {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    /** 적립일(UTC) — 하루 상한의 창이다. */
    @Column(name = "accrued_on", nullable = false)
    private LocalDate accruedOn;

    /** 그날 이 세션이 실제로 섬에 적립한 마리 수 — 상한에 걸려 못 받은 몫은 여기 없다. */
    @Column(name = "earned_fish", nullable = false)
    private int earnedFish;

    /**
     * 그날 이 세션이 황금 물고기로 받은 «자기 몫»(GROMO-1956, V91) — 50 ÷ 함께 낚은 인원(내림)의 합이다.
     *
     * <p>{@link #earnedFish} 와 <b>같은 열에 넣지 않는다</b>: 하루 480마리 상한은 earned_fish 만 합산하는데
     * (기획 정본 「황금 물고기는 480마리 상한과 별도로 지급하며 자체 상한은 두지 않는다」), 섞으면 당첨된
     * 주민이 그날 기본 보상을 그만큼 덜 받는다. 주민 누적 획득 기록만 두 열의 합을 읽는다
     * ({@code FocusFishEarningsRepository}).
     *
     * <p>섬 잔액에 들어간 50마리는 여기 없다 — 그쪽은 섬 원장({@code island_wallet_transactions} 의
     * {@code GOLDEN_FISH})이 정본이고, 이 열은 «주민별» 기록 축이다. 나머지(50 − 몫 × 인원)는 섬에만 남는다.
     */
    @Column(name = "golden_fish", nullable = false)
    private int goldenFish;

    /** 최초 낚시 보상 — 일반 하루 상한과 분당 적립 워터마크에 포함하지 않는다. */
    @Column(name = "tutorial_fish", nullable = false)
    private int tutorialFish;

    public void addTutorial() {
        this.tutorialFish = Math.addExact(this.tutorialFish, 1);
    }

    @CreationTimestamp
    @Column(name = "created_at", columnDefinition = "timestamptz not null default now()")
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", columnDefinition = "timestamptz not null default now()")
    private Instant updatedAt;

    /**
     * 같은 날 같은 세션의 추가 적립 — 호출측이 세션 상세를 배타 잠근 뒤 부른다(그래서 이 행의 동시
     * 갱신자는 없다). 유니크 제약이 최후 방어선이다.
     */
    public void add(int fish) {
        this.earnedFish = Math.addExact(this.earnedFish, fish);
    }

    /**
     * 같은 날 같은 세션의 황금 물고기 몫 추가 — 호출측(황금 추첨)이 세션 상세를 배타 잠근 뒤 부른다.
     * 하루 상한과 무관한 축이라 {@link #add} 와 섞지 않는다.
     */
    public void addGolden(int fish) {
        this.goldenFish = Math.addExact(this.goldenFish, fish);
    }
}

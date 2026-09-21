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
 * 집중 보상 적립 원장 한 줄 (V82, GROMO-1990) — {@code (세션, 적립일)} 당 한 행이다.
 *
 * <p>보상은 이제 종료 정산이 아니라 <b>매분 적립 틱</b>이 확정한다. 그래서 「이 사람이 이 섬에서 언제
 * 얼마를 낚았는가」의 정본은 세션당 1행인 {@code focus_settlements} 가 아니라 이 표다 — 하루 상한
 * 합산도, 회관 기록의 주민 누적 획득({@code FocusFishEarningsRepository})도 여기를 읽는다. 강퇴·포기로
 * 정산 행이 아예 생기지 않는 세션도 이미 적립한 몫은 여기 남는다(회수하지 않는다).
 *
 * <p>적립일은 <b>UTC 날짜</b>다(결정 D8 — 모든 시간 UTC · 하루 리셋 UTC 00:00). 일 집계
 * ({@code daily_focus_stats})의 KST 축과 일부러 다르다: 그쪽은 전환 계획(GROMO-1930) 대기 중인 레거시
 * 축이고, 신규 축은 퀘스트(Q-6)·회관 기록(RC-축)과 같이 처음부터 UTC 다.
 *
 * <p>{@code userId}·{@code islandId} 를 복제하지 않는 것은 의도다 — 상세와 조인하면 탈퇴 익명화
 * (상세의 {@code user_id} 절단)가 이 원장의 집계에도 그대로 따라온다.
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

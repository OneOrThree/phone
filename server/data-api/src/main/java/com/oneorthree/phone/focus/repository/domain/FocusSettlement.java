package com.oneorthree.phone.focus.repository.domain;

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

import java.time.Instant;
import java.util.UUID;

/**
 * 세션당 정산 결과 1건 (V58 {@code focus_settlements}, GROMO-1924 에서 처음 쓴다). PK 가 세션 id 라 한 세션은
 * 두 번 정산되지 않고, 다른 멱등 키로 온 완료 재요청은 이 행을 그대로 돌려준다(LLD §2 finish).
 *
 * <p>보존식 {@code earnedFish = personalFishAdded + constructionFishAdded}(E=P+C, LLD §3). 이름의
 * {@code construction} 은 V58 의 열 이름이고 실제로는 섬 통장 몫이다(D1).
 *
 * <p>꾸미기 보상(GROMO-2301)은 뽑힌 상품을 이 행에 남긴다 — 응답의 {@code seaReward} 는 언제나 이 행에서 만든다.
 *
 * <p>{@code quest_progress}·{@code events} 열은 매핑하지 않는다 — 퀘스트 계약(1772/1773)이 아직 없어 쓸
 * 값이 없고, 사건은 outbox 가 정본이다.
 */
@Entity
@Table(name = "focus_settlements")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSettlement {

    @Id
    @Column(name = "session_id")
    private UUID sessionId;

    @Column(name = "contract_version", nullable = false)
    @Builder.Default
    private int contractVersion = 1;

    @Column(name = "policy_revision")
    private Integer policyRevision;

    @Column(name = "active_seconds", nullable = false)
    private long activeSeconds;

    @Column(name = "goal_achieved", nullable = false)
    private boolean goalAchieved;

    @Column(name = "earned_fish", nullable = false)
    private int earnedFish;

    @Column(name = "personal_fish_added", nullable = false)
    private int personalFishAdded;

    @Column(name = "construction_fish_added", nullable = false)
    private int constructionFishAdded;

    @Column(name = "completed_at", nullable = false)
    private Instant completedAt;

    /**
     * 휴식이 1시간을 넘겨 <b>서버가</b> 끝낸 정산인가 (V88, GROMO-1998). {@code finish} 로 끝난 정산은
     * {@code false} 다 — 그 결과는 응답으로 이미 돌려줬다. 소속 상실 종결(FR-D03)은 정산 행 자체를
     * 만들지 않으므로 이 축과 섞이지 않는다.
     */
    @Column(name = "auto_closed", nullable = false, columnDefinition = "boolean not null default false")
    @Builder.Default
    private boolean autoClosed = false;

    /**
     * 자동 종료 결과창을 보여 준 시각 (V88, GROMO-1998). 「다음 접속에 <b>한 번</b>」의 유일한 근거다 —
     * {@code auto_closed AND acknowledged_at IS NULL} 이 미확인 결과이고, 확인은
     * {@code acknowledged_at IS NULL} 조건부 UPDATE 라 동시·반복 호출에도 최초 1회만 성공한다
     * ({@code league_weekly_results.acknowledged_at} 과 같은 관례).
     */
    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;

    /**
     * 이 세션이 뽑은 꾸미기 보상의 정책 revision (V135, GROMO-2301). 상품 id 와 함께 둘 다 있거나 둘 다 없다(CHECK) —
     * 15분 미만이거나 정책이 없어 뽑지 않았으면 {@code null}. 재조회(새 키 finish·pending-result)는 다시 뽑지 않고 이 값을
     * 읽는다. {@code (revision, product_id)} 가 {@code customization_reward_items} 를 가리킨다(복합 FK).
     */
    @Column(name = "customization_reward_revision")
    private Integer customizationRewardRevision;

    /** 뽑힌 상품 — 이미 가진 상품이어도 남는다(중복 획득). {@link #customizationRewardRevision} 과 한 쌍이다. */
    @Column(name = "customization_reward_product_id", length = 80)
    private String customizationRewardProductId;

    /**
     * 이번 지급으로 보유 행이 새로 생겼는가 (V135) — 결과창 NEW! 표시({@code seaReward.newProductIds})의 정본. 이미 가진
     * 상품을 또 뽑았으면 {@code false}, 뽑지 않았으면 {@code null}({@link #customizationRewardRevision} 과 함께 — CHECK).
     */
    @Column(name = "customization_reward_new")
    private Boolean customizationRewardNew;

    @CreationTimestamp
    @Column(name = "created_at", columnDefinition = "timestamptz not null default now()")
    private Instant createdAt;
}

package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 바다 보상 단계표의 한 행 (GROMO-2274, V112) — 「{@code setKey} 세트의 누적이 {@code thresholdMinutes} 분을 넘으면
 * {@code productId} 를 준다」. 운영이 SQL 로 넣는 <b>데이터</b>라 앱은 읽기만 한다(그래서 생성 팩토리가 없다).
 *
 * <p>{@code setKey} 는 {@link #BASE_SET}(평생 누적 기준) 또는 {@code YYYY-MM}(그 달 누적 기준)이다. 다음 달 시즌은
 * 그 달 키로 행을 넣으면 열린다 — 코드 배포가 없다.
 */
@Entity
@Table(name = "sea_reward_tiers")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SeaRewardTier {

    /** 평생 누적을 기준으로 하는 상시 세트의 키. */
    public static final String BASE_SET = "base";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "set_key", nullable = false, length = 20)
    private String setKey;

    @Column(name = "threshold_minutes", nullable = false)
    private int thresholdMinutes;

    @Column(name = "product_id", nullable = false, length = 80)
    private String productId;

    public boolean isBase() {
        return BASE_SET.equals(setKey);
    }

    /** 단계 기준 초 — 누적이 이 값 «이상»이 되는 순간 넘은 것이다. */
    public long thresholdSeconds() {
        return thresholdMinutes * 60L;
    }
}

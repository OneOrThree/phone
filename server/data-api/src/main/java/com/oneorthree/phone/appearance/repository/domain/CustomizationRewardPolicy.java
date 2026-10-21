package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;

/**
 * 집중 꾸미기 보상 확률 정책 한 revision (GROMO-2313 V133, GROMO-2301 이 읽는다). 행은 마이그레이션이 넣고 서버는
 * 읽기만 한다 — 정산은 가장 큰 revision 을 쓴다. 산식은 {@code appearance/support/CustomizationRewardDraw}.
 *
 * <p>추첨에 쓰지 않는 열(지급 개수 1·중복 허용·원본 엑셀 해시·생성 시각)은 CHECK 가 고정하거나 기록용이라 매핑하지
 * 않는다.
 */
@Entity
@Table(name = "customization_reward_policies")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class CustomizationRewardPolicy {

    @Id
    @Column(name = "revision")
    private int revision;

    /** 이 초 미만이면 보상이 없다(15분). */
    @Column(name = "minimum_active_seconds", nullable = false)
    private int minimumActiveSeconds;

    @Column(name = "rare_unlock_seconds", nullable = false)
    private int rareUnlockSeconds;

    @Column(name = "legendary_unlock_seconds", nullable = false)
    private int legendaryUnlockSeconds;

    /** 시간 가산이 최대치의 절반이 되는 «15분 초과분» 초. */
    @Column(name = "time_half_seconds", nullable = false)
    private int timeHalfSeconds;

    @Column(name = "rare_max_bonus_ppm", nullable = false)
    private int rareMaxBonusPpm;

    @Column(name = "legendary_max_bonus_ppm", nullable = false)
    private int legendaryMaxBonusPpm;

    /**
     * 장소(ISLAND·SEA) → 등급(common·uncommon·rare·legendary) → 해금 전 기본 가중치. 값을 정수로 못 박지 않고 JSON 그대로
     * 읽는다 — 운영이 {@code 1.5}·{@code "x"} 를 넣어도 이 행을 읽는 데서 실패하면 정산 트랜잭션 전체가 롤백되므로, 정수
     * 변환·검증은 {@code CustomizationRewardDraw} 가 추첨 계산 안에서 한다(실패하면 보상만 건너뛴다).
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "location_weights", nullable = false)
    private Map<String, Object> locationWeights;

    /** 카테고리 → 가중치. 여기 없는 카테고리의 아이템은 뽑히지 않는다. 값은 위와 같은 이유로 JSON 그대로다. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "category_weights", nullable = false)
    private Map<String, Object> categoryWeights;
}

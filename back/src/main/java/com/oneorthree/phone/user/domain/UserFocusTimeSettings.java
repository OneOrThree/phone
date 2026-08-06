package com.oneorthree.phone.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 유저별 포커스 타임 목표 설정 (users 1:1).
 * GROMO-561 로 user_screen_time_settings 에서 분리 신설.
 */
@Entity
@Table(name = "user_focus_time_settings")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserFocusTimeSettings {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    // 목표 변경은 changeGoal() 로만 — setter 를 막아 이력(previousGoalMinutes) 이 새는 경로를 없앤다.
    @Setter(AccessLevel.NONE)
    @Column(nullable = false)
    @Builder.Default
    private int dailyFocusTimeGoalMinutes = 0;

    // 직전 목표(분) — 오늘 처음 목표를 바꾸기 전의 값 = '어제 유효했던 목표'. 아직 바꾼 적 없으면 null.
    @Setter(AccessLevel.NONE)
    private Integer previousGoalMinutes;

    // 현재 목표가 유효해진 날짜(유저 로컬). 이 날짜 이전 날의 지급·판정은 previousGoalMinutes 를 쓴다.
    @Setter(AccessLevel.NONE)
    private LocalDate goalEffectiveFrom;

    @UpdateTimestamp
    private Instant updatedAt;

    private Instant deletedAt;

    /**
     * 목표 변경(GROMO-1049) — 지급·판정이 '그날의 목표'를 쓰도록 직전 값을 한 단계 보존한다.
     *
     * <p>보존은 <b>오늘의 첫 변경일 때만</b> 한다. 하루에 여러 번 바꿔도 previousGoalMinutes 가
     * 계속 덮이지 않아야 '어제 유효했던 목표'가 살아남는다.</p>
     *
     * @param newGoalMinutes 새 목표(분)
     * @param today          유저 로컬 기준 오늘
     */
    public void changeGoal(int newGoalMinutes, LocalDate today) {
        if (goalEffectiveFrom == null || goalEffectiveFrom.isBefore(today)) {
            previousGoalMinutes = dailyFocusTimeGoalMinutes;
            goalEffectiveFrom = today;
        }
        dailyFocusTimeGoalMinutes = newGoalMinutes;
    }

    /**
     * 주어진 날짜에 유효했던 목표(분). 이력이 없으면 현재값으로 근사한다(기존 유저·미변경 유저).
     */
    public int goalMinutesOn(LocalDate date) {
        if (goalEffectiveFrom != null && previousGoalMinutes != null && date.isBefore(goalEffectiveFrom)) {
            return previousGoalMinutes;
        }
        return dailyFocusTimeGoalMinutes;
    }
}

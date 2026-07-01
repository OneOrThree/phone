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

    @Column(nullable = false)
    @Builder.Default
    private int dailyFocusTimeGoalMinutes = 0;

    @UpdateTimestamp
    private Instant updatedAt;

    private Instant deletedAt;
}

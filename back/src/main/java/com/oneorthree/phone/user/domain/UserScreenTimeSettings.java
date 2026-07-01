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
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 유저별 스크린타임 권한·목표 설정 (users 1:1).
 * GROMO-561 로 슬림화 — 스크린타임 권한/목표만 남기고 타임존·알림·리포트 필드는
 * users / user_notification_settings 로 분리.
 */
@Entity
@Table(name = "user_screen_time_settings")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserScreenTimeSettings {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "is_screen_time_permission_granted", nullable = false)
    @Builder.Default
    private boolean screenTimePermissionGranted = false;

    @Column(nullable = false)
    @Builder.Default
    private int dailyScreenTimeGoalMinutes = 0;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    private Instant deletedAt;
}

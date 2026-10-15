package com.oneorthree.phone.user.repository.domain;

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
import java.time.LocalTime;
import java.util.UUID;

/**
 * 유저별 알림 설정 (users 1:1).
 * GROMO-561 로 user_screen_time_settings 에서 분리 신설.
 */
@Entity
@Table(name = "user_notification_settings")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserNotificationSettings {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false, columnDefinition = "boolean not null default true")
    @Builder.Default
    private boolean notificationEnabled = true;

    @Column(nullable = false, columnDefinition = "boolean not null default true")
    @Builder.Default
    private boolean soundEnabled = true;

    @Column(nullable = false, columnDefinition = "boolean not null default false")
    @Builder.Default
    private boolean nightModeEnabled = false;

    private LocalTime nightStartTime;

    private LocalTime nightEndTime;

    @UpdateTimestamp
    private Instant updatedAt;

    private Instant deletedAt;
}

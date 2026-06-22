package com.oneorthree.phone.focus.domain;

import com.oneorthree.phone.user.domain.User;

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
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(
        name = "daily_focus_stats",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "date"})
)
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class DailyFocusStat {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(nullable = false)
    private LocalDate date;

    @Builder.Default
    private int totalFocusMinutes = 0;

    @Builder.Default
    private int sessionCount = 0;

    @Builder.Default
    private int distractionCount = 0;

    @Builder.Default
    private int actualScreenTimeMinutes = 0;

    @Builder.Default
    @Column(nullable = false)
    private boolean focusGoalAchieved = false;

    @Builder.Default
    @Column(nullable = false)
    private boolean screenTimeGoalAchieved = false;

    @UpdateTimestamp
    private Instant updatedAt;
}

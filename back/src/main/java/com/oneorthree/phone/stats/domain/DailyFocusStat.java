package com.oneorthree.phone.stats.domain;

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

    // GROMO-642: 분 내림으로 1분 미만 세션이 0으로 누락되던 문제 → 초 단위 누적으로 전환.
    // 응답은 초/60(내림)으로 분 환산(계약 유지). 컬럼: total_focus_seconds (migration v29).
    @Builder.Default
    private int totalFocusSeconds = 0;

    @Builder.Default
    private int sessionCount = 0;

    @Builder.Default
    private int distractionCount = 0;

    @Builder.Default
    @Column(nullable = false)
    private boolean focusGoalAchieved = false;

    @UpdateTimestamp
    private Instant updatedAt;
}

package com.oneorthree.phone.screentime.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
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
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(
        name = "daily_screen_time_stats",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "date"})
)
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class DailyScreenTimeStat {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(nullable = false)
    private LocalDate date;

    /**
     * null = 미집계(V38, GROMO-1267) — "0분 사용"과 다르다. SCREEN_TIME 은 클라 보고 데이터라
     * 값이 안 오면 0 으로 뭉개지 않고 null 로 남긴다(FR-16 · 정책 B7). 판정은 null 을 미보고
     * (= 미달성)로 해석하고, 개인 통계 합산·표시 경로는 0 으로 접는다(응답 shape 불변).
     */
    @Column(name = "total_screen_time_minutes")
    private Integer totalScreenTimeMinutes;

    @Builder.Default
    @Column(name = "is_screen_time_goal_achieved", nullable = false)
    private boolean isScreenTimeGoalAchieved = false;

    @Builder.Default
    @Column(name = "is_screen_time_finalized", nullable = false)
    private boolean screenTimeFinalized = false;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;
}

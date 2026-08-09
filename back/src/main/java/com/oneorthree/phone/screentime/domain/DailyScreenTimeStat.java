package com.oneorthree.phone.screentime.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.domain.User;
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
     * 앱이 보고한 그날의 총 사용 분. <b>null = 미집계</b>이고 0 = 실제 0분 사용이다 (GROMO-1267, 정책 §B7).
     *
     * <p>스크린타임은 <b>적을수록 좋은</b> 축이라 미집계를 0 으로 접으면 미보고가 "0분 사용 = 달성"으로
     * 뒤집힌다 — 돈이 걸린 판정에서 무위험 탈출구가 된다. 그래서 저장 단계에서부터 3상을 유지한다.
     * 읽는 쪽은 null 을 <b>미달성/미표시</b>로 다뤄야 한다(합산에 0 으로 섞지 말 것).
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

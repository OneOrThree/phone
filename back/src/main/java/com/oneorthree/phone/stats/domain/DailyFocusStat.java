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

    // 일별 집계 버킷 날짜 = 유저 country_code 파생 존 로컬 날짜 (GROMO-803, screentime 561과 동일 기준).
    // FocusService.statDate(endedAt, zone) 가 endedAt 을 유저 국가 존으로 환산해 채운다(미지원·null 은 UTC 폴백).
    @Column(nullable = false)
    private LocalDate date;

    // GROMO-642: 분 내림으로 1분 미만 세션이 0으로 누락되던 문제 → 초 단위 누적으로 전환.
    // 응답은 초/60(내림)으로 분 환산(계약 유지). 컬럼: total_focus_seconds (migration v29).
    @Builder.Default
    private int totalFocusSeconds = 0;

    @Builder.Default
    private int sessionCount = 0;

    // GROMO-671(커밋2): distraction_count(횟수) → total_distraction_seconds(초) 의미 변경(기존 값 폐기).
    // 세션의 누적 방해 초(FocusSession.totalDistractionSeconds)를 일별로 누적한다.
    @Builder.Default
    @Column(name = "total_distraction_seconds", nullable = false)
    private int totalDistractionSeconds = 0;

    @Builder.Default
    @Column(name = "is_focus_time_goal_achieved", nullable = false)
    private boolean isFocusTimeGoalAchieved = false;

    @UpdateTimestamp
    private Instant updatedAt;
}

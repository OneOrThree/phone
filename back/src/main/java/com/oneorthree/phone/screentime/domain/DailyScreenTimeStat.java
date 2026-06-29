package com.oneorthree.phone.screentime.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

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

    // TODO GROMO-551: 필드 (focus/domain/DailyFocusStat.java 의 스크린타임 부분 미러)
    //   - @Id @GeneratedUuidV7 UUID id
    //   - @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "user_id") User user
    //       (nullable — 탈퇴 유저 익명 보존 일관성, DailyFocusStat 와 동일)
    //   - @Column(nullable = false) LocalDate date
    //       (물리 컬럼명은 'date' — DailyFocusStat 와 동일. schema.dbml 의 stat_date 표기는 드리프트이므로 따르지 말 것)
    //   - @Builder.Default int actualScreenTimeMinutes = 0
    //   - @Builder.Default @Column(nullable = false) boolean screenTimeGoalAchieved = false
    //   - @UpdateTimestamp Instant updatedAt
    // 주의: (user_id, date) 유니크 — 일별 멱등 upsert 의 키.
}

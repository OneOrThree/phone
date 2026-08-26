package com.oneorthree.phone.bot.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.DayOfWeek;
import java.time.Instant;
import java.util.UUID;

/**
 * 봇 유저의 집중 성향 (GROMO-1565).
 *
 * <p>스케줄을 userId 해시로 도출하지 않고 테이블에 두는 이유는 두 가지다. 승인된 명단을 그대로
 * 재현해야 하고, "고티어 봇을 줄여줘" 같은 조정이 배포 없이 UPDATE 로 끝나야 한다.
 *
 * <p>PK 가 {@code user_id} 인 1:1 확장 테이블이라 {@code UserWallet} 등 기존 부수 테이블과 형태가 같다.
 * 봇이 아닌 유저에는 이 행이 없다.
 */
@Entity
@Table(name = "bot_profiles")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class BotProfile {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BotChronotype chronotype;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BotStyle style;

    /** 주간 목표 집중 분. 티어 유지 구간(14/28/42/56시간) 안쪽에 둔다. */
    @Column(name = "weekly_minutes", nullable = false)
    private int weeklyMinutes;

    /** 주 며칠 집중하는가 (4~6). */
    @Column(name = "active_days", nullable = false)
    private int activeDays;

    /** 쉬는 요일 비트마스크 — 비트 0 = 월요일 … 비트 6 = 일요일. */
    @Column(name = "rest_day_mask", nullable = false)
    private int restDayMask;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public boolean restsOn(DayOfWeek dayOfWeek) {
        return (restDayMask & (1 << (dayOfWeek.getValue() - 1))) != 0;
    }

    /** 활동일 하루에 채울 평균 집중 분 — 요일별 변동은 스케줄 생성에서 얹는다. */
    public double averageDailyMinutes() {
        return weeklyMinutes / (double) activeDays;
    }
}

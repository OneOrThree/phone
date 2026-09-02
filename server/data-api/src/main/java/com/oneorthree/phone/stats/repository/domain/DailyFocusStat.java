package com.oneorthree.phone.stats.repository.domain;

import com.oneorthree.phone.user.repository.domain.User;

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

/**
 * 하루치 집중 집계 한 줄. (user_id, date) 유니크라 유저·날짜당 행은 하나뿐이고, 세션이 끝날 때마다
 * 이 행에 누적된다 — 그래서 동시 누적은 행 락으로 직렬화한다(lost update 방지).
 *
 * <p>버킷 축은 KST 로컬 날짜다. 자정을 넘긴 세션은 통째로 한쪽에 몰지 않고 로컬 자정에서 잘라 날짜별로
 * 나눠 담으므로, 실제로 집중한 날에 귀속된다. 누적 단위는 <b>초</b>이고 분 환산은 응답을 만들 때만 한다 —
 * 세션마다 분으로 내림하면 1분 미만이 통째로 사라지기 때문이다.
 */
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

    /**
     * 일별 집계 버킷 날짜 = KST 로컬 날짜 (GROMO-1259 — 저장축 KST 고정, 스크린타임과 동일 기준).
     * GROMO-1252: 세션 구간을 유저 국가 존의 로컬 자정으로 잘라(FocusService.splitByLocalDay) 날짜별로 나눠
     * 채운다 — 자정 걸친 세션도 실제로 집중한 날에 귀속된다(미지원·null 존은 Asia/Seoul 폴백).
     */
    @Column(nullable = false)
    private LocalDate date;

    /**
     * GROMO-642: 분 내림으로 1분 미만 세션이 0으로 누락되던 문제 → 초 단위 누적으로 전환.
     * 응답은 초/60(내림)으로 분 환산(계약 유지). 컬럼: total_focus_seconds (migration v29).
     */
    @Builder.Default
    private int totalFocusSeconds = 0;

    @Builder.Default
    private int sessionCount = 0;

    /**
     * GROMO-671(커밋2): distraction_count(횟수) → total_distraction_seconds(초) 의미 변경(기존 값 폐기).
     * 세션의 누적 방해 초(FocusSession.totalDistractionSeconds)를 일별로 누적한다.
     */
    @Builder.Default
    @Column(name = "total_distraction_seconds", nullable = false)
    private int totalDistractionSeconds = 0;

    @Builder.Default
    @Column(name = "is_focus_time_goal_achieved", nullable = false)
    private boolean isFocusTimeGoalAchieved = false;

    @UpdateTimestamp
    private Instant updatedAt;
}

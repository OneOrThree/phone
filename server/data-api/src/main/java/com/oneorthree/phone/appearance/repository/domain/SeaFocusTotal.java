package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * 바다 집중 누적 (GROMO-2274, V117) — 유저 한 명당 한 행. 평생 누적은 줄지 않고, 이번 달 누적은 정산 달이
 * {@link #monthKey} 보다 <b>늦어질 때만</b> 0 에서 다시 시작한다(앞으로만 — 시계가 뒤로 가도 되돌리지 않는다).
 * 달 리셋은 가산 직전에 {@link #add} 가 하므로 월초 크론이 없다.
 *
 * <p>섬·항해 도착 여부를 담지 않는다 — 「도착 여부 무관」누적이다. 행은 {@code SeaFocusRewardService} 만 쓰고
 * (정산 한 번에 가산 한 번), 계정 탈퇴가 지운다.
 */
@Entity
@Table(name = "sea_focus_totals")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SeaFocusTotal {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "lifetime_seconds", nullable = false)
    private long lifetimeSeconds;

    /** 월 누적이 쌓이는 달 — 지금까지 정산 달 중 가장 늦은 것, KST {@code YYYY-MM}. 고정 7자라 {@code char(7)} 이다. */
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "month_key", nullable = false, length = 7)
    private String monthKey;

    @Column(name = "month_seconds", nullable = false)
    private long monthSeconds;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 가산 — 정산 달이 저장된 달보다 <b>늦을 때만</b> 월 누적을 0 으로 되돌린 뒤 더한다. 같은 달이면 그대로 더하고,
     * 시계가 뒤로 가 더 이른 달이 계산돼도 되돌리지 않고 저장된 달의 누적에 더한다 — 새 달 누적이 지워지지 않는다.
     * 평생 누적은 늘 더한다. {@code YYYY-MM} 은 사전순이 곧 시간순이다.
     */
    public void add(long seconds, String monthKey, Instant now) {
        if (monthKey.compareTo(this.monthKey) > 0) {
            this.monthKey = monthKey;
            this.monthSeconds = 0L;
        }
        this.lifetimeSeconds = Math.addExact(this.lifetimeSeconds, seconds);
        this.monthSeconds = Math.addExact(this.monthSeconds, seconds);
        this.updatedAt = now;
    }
}

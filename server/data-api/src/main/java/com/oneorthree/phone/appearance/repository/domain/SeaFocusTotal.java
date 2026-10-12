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
 * 바다 집중 누적 (GROMO-2274, V112) — 유저 한 명당 한 행. 평생 누적은 줄지 않고, 이번 달 누적은 {@link #monthKey}
 * 가 갈리면 0 에서 다시 시작한다. 달 리셋은 가산 직전에 {@link #add} 가 하므로 월초 크론이 없다.
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

    /** 마지막 가산이 속한 달 — KST {@code YYYY-MM}. 고정 7자라 {@code char(7)} 이다. */
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "month_key", nullable = false, length = 7)
    private String monthKey;

    @Column(name = "month_seconds", nullable = false)
    private long monthSeconds;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * {@code monthKey} 달 기준의 월 누적 — 저장된 달과 다르면 아직 한 번도 가산하지 않은 달이라 0 이다.
     * 가산 «전» 값을 읽어 단계 통과를 판정할 때 쓴다.
     */
    public long monthSecondsIn(String monthKey) {
        return this.monthKey.equals(monthKey) ? monthSeconds : 0L;
    }

    /** 가산 — 저장된 달과 다르면 월 누적을 0 으로 되돌린 뒤 더한다. 평생 누적은 늘 더한다. */
    public void add(long seconds, String monthKey, Instant now) {
        if (!this.monthKey.equals(monthKey)) {
            this.monthKey = monthKey;
            this.monthSeconds = 0L;
        }
        this.lifetimeSeconds = Math.addExact(this.lifetimeSeconds, seconds);
        this.monthSeconds = Math.addExact(this.monthSeconds, seconds);
        this.updatedAt = now;
    }
}

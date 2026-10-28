package com.oneorthree.phone.focus.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 바다 방에서 보이는 한마디 (V124, GROMO-2299). 사용자당 한 행이고, 행이 없으면 한마디가 없다. {@code changedAt} 은
 * 직전 변경 시각이며 5분 잠금의 기준이다.
 */
@Entity
@Table(name = "sea_remarks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SeaRemark {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false, length = 20)
    private String remark;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    public SeaRemark(UUID userId, String remark, Instant changedAt) {
        this.userId = userId;
        this.remark = remark;
        this.changedAt = changedAt;
    }

    public void change(String remark, Instant changedAt) {
        this.remark = remark;
        this.changedAt = changedAt;
    }
}

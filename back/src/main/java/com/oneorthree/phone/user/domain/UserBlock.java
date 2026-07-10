package com.oneorthree.phone.user.domain;

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
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 유저 차단 관계 — 방향성 있음(blocker 가 blocked 를 차단). 친구 관계와 독립.
 *
 * <p>GROMO-676 스키마+매핑 선반영 — 차단 기능 로직은 별도 티켓에서 구현한다.
 */
@Entity
@Table(
        name = "user_blocks",
        uniqueConstraints = @UniqueConstraint(columnNames = {"blocker_id", "blocked_id"})
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserBlock {

    @Id
    @GeneratedUuidV7
    private UUID id;

    // 차단한 유저
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "blocker_id", nullable = false)
    private User blocker;

    // 차단당한 유저
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "blocked_id", nullable = false)
    private User blocked;

    // 차단 시각
    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}

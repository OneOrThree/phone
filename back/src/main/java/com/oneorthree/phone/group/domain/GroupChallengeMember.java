package com.oneorthree.phone.group.domain;

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
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 그룹 챌린지 멤버별 진행·달성 (챌린지는 그룹 전원 자동 적용 전제 — 이 테이블은 개인별 진행/결과).
 * GROMO-561 범위 = 스키마 + 엔티티 매핑까지. 진행/달성 집계 로직·조회 API 는 별도 티켓.
 */
@Entity
@Table(
        name = "group_challenge_members",
        uniqueConstraints = @UniqueConstraint(columnNames = {"group_challenge_id", "user_id"})
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeMember {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_challenge_id", nullable = false)
    private GroupChallenge groupChallenge;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "progress_minutes", nullable = false)
    @Builder.Default
    private int progressMinutes = 0;

    @Column(name = "is_achieved", nullable = false)
    @Builder.Default
    private boolean isAchieved = false;

    @Column(name = "achieved_at")
    private Instant achievedAt;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    // 소프트 딜리트 (삭제 시각)
    private Instant deletedAt;
}

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
import java.time.LocalDate;
import java.util.UUID;

/**
 * 그룹 챌린지 멤버별 클라 보고 원본값 — 스크린타임 창(TIME_WINDOW×SCREEN_TIME) 사용분의 날짜별 저장(V20 재활용).
 *
 * <p>판정(달성 여부)은 조회 시 계산한다 — 이 테이블은 클라가 보고한 원본값({@code progressMinutes})과
 * 보고 날짜({@code usageDate})만 담는다. GROMO-561 시절 잔재였던 {@code is_achieved}·
 * {@code achieved_at}·{@code deleted_at} 은 V32 에서 컬럼째 제거됐다(갱신하는 코드가 없었다).
 */
@Entity
@Table(
        name = "group_challenge_members",
        uniqueConstraints = @UniqueConstraint(columnNames = {"group_challenge_id", "user_id", "usage_date"})
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

    // 클라가 보고한 창 내 사용 분 원본값 — 서버는 범위(0~1440)만 검증하고 그대로 저장한다(클라 신뢰).
    @Column(name = "progress_minutes", nullable = false)
    @Builder.Default
    private int progressMinutes = 0;

    // 보고 날짜(KST 로컬, V20). NOT NULL (V32) — nullable 이면 UNIQUE (챌린지, 유저, 날짜) 가
    // NULL 끼리 안 걸려 같은 (챌린지, 유저)로 행이 무한히 쌓인다. 레거시 NULL 행은 V32 가 삭제했다.
    @Column(name = "usage_date", nullable = false)
    private LocalDate usageDate;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;
}

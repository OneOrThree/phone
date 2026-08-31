package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "group_challenges")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallenge {

    // type 별 파라미터는 CTI 상세 테이블에 1:1 로 분리 —
    //   DURATION → GroupChallengeDuration, TIME_WINDOW → GroupChallengeWindow.

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MissionType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupChallengeStatus status = GroupChallengeStatus.ACTIVE;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MissionCategory category;

    /**
     * 도는 요일 집합 비트마스크(§A3 · V34) — ISO 요일(월=1…일=7)을 {@code 1 << (dow-1)} 로 접는다.
     * 값 범위는 1~127(DB CHECK) — 0(요일 없음)은 저장 불가. 판정·전개는 {@link RepeatSchedule} 단일 유틸.
     * 구앱(필드 미전송) 생성과 V34 이전 기존 행은 127(매일)이다.
     */
    @Column(name = "repeat_days", nullable = false)
    @Builder.Default
    private int repeatDays = RepeatSchedule.EVERYDAY;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * 활동 시작 시각(V34) — 생성 즉시 돌기 시작하므로 created_at 과 같은 시점에 채운다
     * (기존 행 백필도 created_at). 이력 표기의 "언제부터"가 이 컬럼이다.
     */
    @CreationTimestamp
    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt;

    /** 종료 시각(V34) — null 이면 진행 중. {@link #end()} 가 ENDED 전이와 함께 채운다. */
    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    /**
     * 삭제 마킹(soft delete). 하드 딜리트는 CTI 상세(durations/windows)의 challenge_id FK 를 위반하고
     * 이력도 잃으므로 쓰지 않는다. 이미 삭제된 챌린지는 조회 단계에서 걸러지므로 여기서는 멱등하게 둔다.
     */
    public void softDelete() {
        if (deletedAt == null) {
            this.deletedAt = Instant.now();
        }
    }

    /**
     * 종료 전이(§A8 · GROMO-1261) — 새 회차를 더 세우지 않는 깨끗한 마감. 멱등: 이미 ENDED 면 무변경
     * (재호출이 ended_at 을 당겨쓰지 않는다). OPEN 회차 가드(FR-11)와 배타 락(N42)은 호출측
     * ({@code GroupChallengeService#endChallenge}) 책임이다.
     */
    public void end() {
        if (status != GroupChallengeStatus.ENDED) {
            this.status = GroupChallengeStatus.ENDED;
            this.endedAt = Instant.now();
        }
    }
}

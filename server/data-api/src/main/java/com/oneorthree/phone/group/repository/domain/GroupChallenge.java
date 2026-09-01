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

/**
 * 그룹 챌린지 — 그룹 안에서 <b>반복해서 도는 목표</b> 하나. "언제 재나"({@link MissionType})와
 * "무엇을 재나"({@link MissionCategory}), 도는 요일({@code repeatDays})을 소유하고, 목표치 같은 형태별
 * 파라미터는 CTI 상세 테이블이 든다.
 *
 * <p>살아 있는 챌린지인지는 <b>두 축</b>을 함께 봐야 한다: {@code status}(진행/종료)와
 * {@code deletedAt}(소프트 삭제). 삭제를 상태값으로 접지 않은 이유는 "종료된 챌린지"와 "지워진 챌린지"의
 * 이력 취급이 다르기 때문이고, 그래서 조회는 대부분 {@code deletedAt IS NULL} 을 함께 건다.
 *
 * <p>참가·판정·정산의 단위는 이 행이 아니라 회차({@link GroupChallengeBetSession})다 — 회차는 개설
 * 시점에 카테고리·방식·목표·참가비를 <b>스냅샷으로 박제</b>하므로, 이 행이 나중에 어떻게 바뀌거나
 * 지워져도 이미 열린 회차의 판정 기준은 흔들리지 않는다.
 */
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

package com.oneorthree.phone.group.domain;

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
     * 도는 요일 집합 — ISO 요일 비트마스크(월=1 … 일=64, {@link RepeatSchedule}). 1~127, 0 은 저장 불가.
     *
     * <p>기본값을 {@link RepeatSchedule#EVERY_DAY} 로 두는 것은 <b>요일을 지정하지 않은 코드 경로의
     * 하위 호환</b>일 뿐이다(V32 백필과 같은 값 = 요일 개념 도입 전의 현행 동작). 유저 입력 경로는
     * 기본값이 없다 — 요일 미선택은 {@code CHALLENGE_REPEAT_DAYS_REQUIRED} 400 이다(정책 §A3).
     */
    @Column(name = "repeat_days", nullable = false)
    @Builder.Default
    private short repeatDays = (short) RepeatSchedule.EVERY_DAY;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /** 활동 시작 시각. 생성 = 시작이라 기존 행은 created_at 으로 백필했다(V32). */
    @Column(name = "started_at", nullable = false)
    @Builder.Default
    private Instant startedAt = Instant.now();

    /** 종료 시각. null = 진행 중. {@link #end()} 만 채운다. */
    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    /**
     * 종료 마킹 (정책 §A8) — 카드에서 내려가고 판정·알림·회차가 멈춘다. 삭제와 달리 진행 중인
     * 회차가 없을 때만 허용되며, 그 가드는 서비스가 챌린지 행을 잠근 채 검사한다.
     *
     * <p><b>{@code INACTIVE} 가 곧 "종료(ENDED)"다.</b> 정책 표기는 {@code ENDED} 지만 DB CHECK 도메인이
     * V2 이래 {@code ACTIVE/INACTIVE} 이고, 앱이 응답의 status 문자열로 분기한다 — 이름을 바꾸면
     * 데이터 이관 + CHECK 교체 + 앱 계약 파기가 한꺼번에 필요하다. 의미만 확정하고 이름은 그대로 둔다.
     *
     * <p>이미 종료된 챌린지에는 멱등이다 — 종료 시각을 덮어쓰지 않는다(재호출이 이력을 앞당기면 안 된다).
     */
    public void end() {
        if (status == GroupChallengeStatus.ACTIVE) {
            this.status = GroupChallengeStatus.INACTIVE;
            this.endedAt = Instant.now();
        }
    }

    /** 종료됐는가 — {@code INACTIVE} 의 의미 확정({@link #end()})을 호출측이 되풀이하지 않도록. */
    public boolean isEnded() {
        return status != GroupChallengeStatus.ACTIVE;
    }

    /**
     * 삭제 마킹(soft delete). 하드 딜리트는 CTI 상세(durations/windows)의 challenge_id FK 를 위반하고
     * 이력도 잃으므로 쓰지 않는다. 이미 삭제된 챌린지는 조회 단계에서 걸러지므로 여기서는 멱등하게 둔다.
     */
    public void softDelete() {
        if (deletedAt == null) {
            this.deletedAt = Instant.now();
        }
    }
}

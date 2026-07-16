package com.oneorthree.phone.focus.domain;

import com.oneorthree.phone.user.domain.User;

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
@Table(name = "focus_sessions")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSession {

    // GROMO-673: focus_tag_id 의 참조 대상을 focus_tags → user_focus_tags 로 재지정한다.
    // 컬럼명(focus_tag_id)은 유지하고 FK 대상만 user_focus_tags 로 바뀐다.

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    // GROMO-673: 유저가 채택한 태그(user_focus_tags). nullable — 태그 없는 세션 허용.
    // 참조 태그는 소프트 딜리트(user_focus_tags.deleted_at) 되므로 하드 삭제로 인한 참조 무결성 파손이 없다.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "focus_tag_id")
    private UserFocusTag focusTag;

    // GROMO-671(커밋1): 소속 일일 집계(FK → daily_focus_stats). nullable — 진행 중 세션은 미귀속.
    @Column(name = "daily_focus_stat_id")
    private UUID dailyFocusStatId;

    // GROMO-671(커밋1): 세션 생명주기 (deleted_at 대체 예정). 라이브 = ACTIVE.
    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private FocusSessionStatus status = FocusSessionStatus.ACTIVE;

    // GROMO-671(커밋1): 세션 유형(INFINITE / RANGE / POMODORO).
    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "focus_type", nullable = false)
    private FocusType focusType = FocusType.INFINITE;

    @Column(nullable = false)
    private Instant startedAt;

    // 라이브 세션(GROMO-610): 진행 중이면 null, 종료 시 채워짐.
    // 과거 nullable=false 였으나 '시작만 저장' 경로를 위해 NOT NULL 제거 — friend isFocusing 판정(endedAt IS NULL) 전제.
    private Instant endedAt;

    @Builder.Default
    private int totalDistractionSeconds = 0;

    // GROMO-671(커밋1): 세션 생성 시각.
    @CreationTimestamp
    private Instant createdAt;

    /**
     * 진행 중 세션에 종료 시각·방해 지표(누적 초)를 채워 완료 처리(더티 체킹).
     *
     * <p>GROMO-733: 완료 전이 시 status 를 COMPLETED 로 세팅한다. 벌크(endSessionIfActive)는 status-agnostic 하게
     * endedAt 만 원자 세팅하고, COMPLETED 는 이 관리 엔티티 더티 flush 로 정확히 반영한다.
     */
    public void end(Instant endedAt, int totalDistractionSeconds) {
        this.endedAt = endedAt;
        this.totalDistractionSeconds = totalDistractionSeconds;
        this.status = FocusSessionStatus.COMPLETED;
    }

    /**
     * 유저 취소(GROMO-733) — status=CANCELED 로 전이하고 취소 시각을 endedAt 에 채운다(더티 체킹).
     *
     * <p>조건부 원자 UPDATE(cancelSessionIfActive)가 벌크로 CANCELED·endedAt 를 성사시킨 뒤, 관리 엔티티를
     * 같은 값으로 정합시켜 영속성 컨텍스트의 낡은 상태(ACTIVE)를 제거한다. 통계·스트릭 귀속은 없다.
     */
    public void cancel(Instant canceledAt) {
        this.endedAt = canceledAt;
        this.status = FocusSessionStatus.CANCELED;
    }

    // GROMO-804: orphan 자동 종료 — 종료 시각을 상한으로 채우고 상태를 AUTO_CLOSED 로 표시한다.
    // 통계·스트릭 미반영은 호출부(sweepOrphanSessions)가 recordCompletion 을 부르지 않음으로 보장하고,
    // 이 status 로 by-category 실시간 집계에서도 제외된다. distraction 은 유저 미확정이라 건드리지 않는다.
    public void autoClose(Instant endedAt) {
        this.endedAt = endedAt;
        this.status = FocusSessionStatus.AUTO_CLOSED;
    }

    // GROMO-671(커밋3): 소프트딜리트/취소는 deleted_at 대신 status=CANCELED 로 표현한다.
    // (기존에도 deleted_at 세팅/전환 배선은 후속 티켓이었음 — 여기선 조회 필터만 status 기반으로 전환.)

    /** 시작 시 미지정한 태그(user_focus_tags)를 종료 시점에 보정. */
    public void applyTag(UserFocusTag focusTag) {
        this.focusTag = focusTag;
    }

    /** 종료 여부(endedAt 존재). */
    public boolean isEnded() {
        return endedAt != null;
    }
}

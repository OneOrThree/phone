package com.oneorthree.phone.focus.repository.domain;

import com.oneorthree.phone.user.repository.domain.User;

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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
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

    /**
     * GROMO-673: 유저가 채택한 태그(user_focus_tags). nullable — 태그 없는 세션 허용.
     * 참조 태그는 소프트 딜리트(user_focus_tags.deleted_at) 되므로 하드 삭제로 인한 참조 무결성 파손이 없다.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "focus_tag_id")
    private UserFocusTag focusTag;

    /**
     * GROMO-671(커밋1): 소속 일일 집계(FK → daily_focus_stats). nullable — 진행 중 세션은 미귀속.
     */
    @Column(name = "daily_focus_stat_id")
    private UUID dailyFocusStatId;

    /**
     * GROMO-671(커밋1): 세션 생명주기 (deleted_at 대체 예정). 라이브 = ACTIVE.
     */
    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private FocusSessionStatus status = FocusSessionStatus.ACTIVE;

    /**
     * GROMO-671(커밋1): 세션 유형(INFINITE / RANGE / POMODORO).
     */
    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "focus_type", nullable = false)
    private FocusType focusType = FocusType.INFINITE;

    @Column(nullable = false)
    private Instant startedAt;

    /**
     * 라이브 세션(GROMO-610): 진행 중이면 null, 종료 시 채워짐.
     * 과거 nullable=false 였으나 '시작만 저장' 경로를 위해 NOT NULL 제거 — friend isFocusing 판정(endedAt IS NULL) 전제.
     */
    private Instant endedAt;

    /**
     * GROMO-1287: 시작 요청이 실어 보낸 **클램프 이전** 클라 시각 — 마커 순서 판정 전용이다.
     * startedAt 은 clampToServerNow 를 거쳐 저장되는데, 5분 넘게 백그라운드에 있다 여러 블록을
     * 리플레이하면 과거 시각들이 **전부 서버 now 로 치환**돼 논리 순서가 지워진다. 그 상태에서
     * 새 요청의 원시 시각을 저장된(=클램프된) 값과 비교하면 **축이 어긋나** 논리적으로 더 늦은
     * 블록이 과거로 판정되고, 그 블록이 마커를 못 받아 라이브 표시가 비고 정산 가드까지 풀린다.
     * 그래서 원시끼리 비교할 수 있도록 이 값을 따로 남긴다.
     *
     * ⚠️ 저장·집계·보상에는 절대 쓰지 않는다 — 클라가 보낸 값이라 위조 가능하고, GROMO-1214 의
     * "클라 시각이 저장·집계에 들어가지 않는다" 계약은 그대로다. 순서 비교에만 쓴다.
     * 레거시·구버전이 만든 행은 null 이라 판정측이 startedAt 으로 폴백한다(statEndAt 과 같은 관행).
     */
    private Instant clientStartedAt;

    /**
     * GROMO-1252(코드리뷰 2차 ②): 통계 귀속용 '유효 종료 시각' = min(endedAt, 완료 시점 서버 now).
     * endedAt 은 클라가 보낸 값 그대로 저장해야 재업로드 중복 검사(existsByUserAndStartedAtAndEndedAtAndStatus)가
     * 성립하는데, 미래 endedAt 위조 세션은 조회 시점 now 로 클리핑하는 by-category 가 시간이 갈수록 더 세게 된다
     * (사전집계 DailyFocusStat 는 완료 시점 클램프라 고정) → 완료 순간의 클램프 결과를 여기 고정 보관해
     * 모든 조회가 같은 값으로 자르게 한다. 레거시 row 는 null 이라 조회측이 endedAt 으로 폴백한다.
     */
    private Instant statEndAt;

    /**
     * GROMO-1252(코드리뷰 3차 ①): 완료 시점에 확정한 날짜별 집중 초 분포
     * (유저 존 로컬 날짜 "YYYY-MM-DD" → 초). 앱이 실어 보낸 분포를 날짜별 벽시계 몫으로 클램프한 결과이며,
     * 앱이 안 보냈으면 벽시계 분할에서 방해 초를 뺀 값이다 — 사전집계 DailyFocusStat 에 가산한 값과 동일하다.
     * ⚠️ 어느 경로든 **순수 집중 초(net, 일시정지 제외)** 로 통일해 저장한다(GROMO-1214 코드리뷰 3차 ①) —
     * 읽는 쪽(by-category·앱 복원)이 방해 비율을 다시 빼면 이중 차감이다.
     * 이걸 안 남기면 조회 집계(by-category)·앱 복원이 구간을 다시 벽시계로 잘라 사전집계와 어긋난다
     * (일시정지가 자정을 걸치면 300/300 vs 600/900). 레거시 row 는 null → 조회측이 벽시계로 폴백.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "focus_seconds_by_date")
    private Map<String, Integer> focusSecondsByDate;

    @Builder.Default
    private int totalDistractionSeconds = 0;

    /**
     * GROMO-671(커밋1): 세션 생성 시각.
     */
    @CreationTimestamp
    private Instant createdAt;

    /**
     * 진행 중 세션에 종료 시각·방해 지표(누적 초)를 채워 완료 처리(더티 체킹).
     *
     * <p>GROMO-733: 완료 전이 시 status 를 COMPLETED 로 세팅한다. 벌크(endSessionIfActive)는 status-agnostic 하게
     * endedAt 만 원자 세팅하고, COMPLETED 는 이 관리 엔티티 더티 flush 로 정확히 반영한다.
     */
    public void end(Instant endedAt, int totalDistractionSeconds, Instant statEndAt,
                    Map<String, Integer> focusSecondsByDate) {
        this.endedAt = endedAt;
        this.totalDistractionSeconds = totalDistractionSeconds;
        this.statEndAt = statEndAt;
        this.focusSecondsByDate = focusSecondsByDate;
        this.status = FocusSessionStatus.COMPLETED;
    }

    /** 통계 귀속용 유효 종료 시각 — 미기록(레거시 row)이면 endedAt 으로 폴백한다(GROMO-1252). */
    public Instant statEndOrEndedAt() {
        return statEndAt != null ? statEndAt : endedAt;
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

    /**
     * GROMO-804: orphan 자동 종료 — 종료 시각을 상한으로 채우고 상태를 AUTO_CLOSED 로 표시한다.
     * 통계·스트릭 미반영은 호출부(sweepOrphanSessions)가 recordCompletion 을 부르지 않음으로 보장하고,
     * 이 status 로 by-category 실시간 집계에서도 제외된다. distraction 은 유저 미확정이라 건드리지 않는다.
     */
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

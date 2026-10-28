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
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * 집중 세션의 기본 기록. {@code endedAt}이 null이면 진행 중이다.
 *
 * <p>상세 상태와 구간은 별도 테이블에 두고, 정상 종료 시 확정한 집중 시간과 날짜별 분포를
 * 이 행에 기록한다. 집계용 종료 시각이 없는 이전 기록은 저장된 종료 시각으로 보완한다.
 */
@Entity
@Table(name = "focus_sessions")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSession {


    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;


    /**
     * GROMO-671(커밋1): 소속 일일 집계(FK → daily_focus_stats). nullable — 진행 중 세션은 미귀속.
     */
    @Column(name = "daily_focus_stat_id")
    private UUID dailyFocusStatId;

    /**
     * 기본 세션의 상태. 진행 중 상태는 ACTIVE다.
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
     * 이전 기록이 보관한 클라이언트 시작 시각. 현재 세션은 서버 시작 시각을 기준으로 처리한다.
     */
    private Instant clientStartedAt;

    /**
     * 집계에 사용할 확정 종료 시각. 이전 기록에서 값이 없으면 {@link #statEndOrEndedAt}이
     * 저장된 종료 시각을 반환한다.
     */
    private Instant statEndAt;

    /**
     * 정상 종료 시 확정한 KST 날짜별 순수 집중 초. 휴식 시간을 다시 차감하지 않는다.
     * 이전 기록에서는 값이 없을 수 있다.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "focus_seconds_by_date")
    private Map<String, Integer> focusSecondsByDate;

    @Builder.Default
    private int totalDistractionSeconds = 0;

    /**
     * GROMO-1743: 집중 프레즌스 리스의 순서 판정 키 — DB 시퀀스가 INSERT 때 채운다(V77).
     *
     * <p>세션 id(UUID v7)의 앞자리는 id 를 만든 인스턴스의 벽시계라, 여러 대로 늘리면 순서가 어긋난다.
     * 같은 사용자의 시작은 users 행 배타 락 아래서 INSERT 되므로 이 번호의 순서가 곧 커밋 순서다.
     *
     * <p>V77 이전에 끝난 행은 {@code null} 이다 — 읽는 쪽이 순서 판정을 건너뛴다. {@code bigserial} 은
     * ci 의 create-drop 스키마에 시퀀스를 같이 만들게 하려는 선언이고, 운영 스키마(V77)는 널 허용
     * {@code bigint DEFAULT nextval(...)} 이다(둘 다 BIGINT 라 validate 가 통과한다).
     */
    @Generated
    @Column(name = "presence_order", insertable = false, updatable = false, columnDefinition = "bigserial")
    private Long presenceOrder;

    /**
     * GROMO-671(커밋1): 세션 생성 시각.
     */
    @CreationTimestamp
    private Instant createdAt;

    /**
     * 잠긴 기본 세션에 종료 시각과 확정된 집중 시간을 기록하고 COMPLETED로 전이한다.
     *
     * @param endedAt 종료 시각
     * @param totalDistractionSeconds 누적 방해 초
     * @param statEndAt 집계용 종료 시각
     * @param focusSecondsByDate KST 날짜별 순수 집중 초
     */
    public void end(Instant endedAt, int totalDistractionSeconds, Instant statEndAt,
                    Map<String, Integer> focusSecondsByDate) {
        this.endedAt = endedAt;
        this.totalDistractionSeconds = totalDistractionSeconds;
        this.statEndAt = statEndAt;
        this.focusSecondsByDate = focusSecondsByDate;
        this.status = FocusSessionStatus.COMPLETED;
    }

    /**
     * 통계 귀속용 유효 종료 시각 — 이전 기록에서 값이 없으면 endedAt 으로 폴백한다(GROMO-1252).
     *
     * @return 집계가 세션 꼬리를 자를 때 쓸 종료 시각. 진행 중 세션이면 둘 다 null 이라 null 이 나온다
     */
    public Instant statEndOrEndedAt() {
        return statEndAt != null ? statEndAt : endedAt;
    }

    /**
     * 기본 세션을 CANCELED로 전이하고 종료 시각을 기록한다.
     *
     * @param canceledAt 서버가 결정한 취소 시각
     */
    public void cancel(Instant canceledAt) {
        this.endedAt = canceledAt;
        this.status = FocusSessionStatus.CANCELED;
    }

    /**
     * 기본 세션을 AUTO_CLOSED로 전이하고 종료 시각을 기록한다.
     *
     * @param endedAt 서버가 결정한 마감 시각
     */
    public void autoClose(Instant endedAt) {
        this.endedAt = endedAt;
        this.status = FocusSessionStatus.AUTO_CLOSED;
    }



    /**
     * 종료 여부(endedAt 존재).
     *
     * @return 마감됐으면 true. 완료·취소·자동마감을 <b>가리지 않는다</b> — 통계 반영 여부는 status 로 봐야 한다
     */
    public boolean isEnded() {
        return endedAt != null;
    }
}

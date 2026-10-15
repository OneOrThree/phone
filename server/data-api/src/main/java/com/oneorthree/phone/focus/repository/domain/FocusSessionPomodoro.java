package com.oneorthree.phone.focus.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToOne;
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
 * POMODORO 세션 상세 (focus_session_pomodoros) — focus_sessions 1:1, focus_type=POMODORO 세션만 행 존재.
 * 타입별 필드 분리(CTI)로 focus_sessions 의 NULL 오염을 막는다.
 *
 * <p>GROMO-675: dbml 정합 선반영 — 스키마+매핑만. 포모도로 세션 플로(세트 집계 등)는 별도 기능 티켓.
 */
@Entity
@Table(name = "focus_session_pomodoros")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSessionPomodoro {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /** 대상 세션 (1:1 — focus_type=POMODORO 인 세션만). */
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "focus_session_id", nullable = false, unique = true)
    private FocusSession focusSession;

    /** 사용 프리셋 (nullable — 커스텀 설정이면 null). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pomodoro_setting_id")
    private PomodoroSetting pomodoroSetting;

    /** 1세트 기준 집중 시간(분). */
    @Column(name = "focus_minutes", nullable = false)
    private int focusMinutes;

    /** 1세트 기준 휴식 시간(분). */
    @Column(name = "break_minutes", nullable = false)
    private int breakMinutes;

    /** 완료 세트 수. */
    @Column(name = "set_count", nullable = false)
    private int setCount;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}

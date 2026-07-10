package com.oneorthree.phone.focus.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
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
 * 뽀모도로 집중/휴식 시간 프리셋 (focus_sessions_pomodoro_setting) — 서버 관리 시드(하드코딩 대체).
 *
 * <p>GROMO-675: dbml 정합 선반영 — 스키마+매핑만. 프리셋 조회/포모도로 세션 플로 API 는 별도 기능 티켓.
 */
@Entity
@Table(name = "focus_sessions_pomodoro_setting")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class PomodoroSetting {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /** 프리셋 표시명 (예: 클래식 25/5). */
    @Column(nullable = false)
    private String name;

    /** 집중 시간(분). */
    @Column(name = "focus_minutes", nullable = false)
    private int focusMinutes;

    /** 휴식 시간(분). */
    @Column(name = "break_minutes", nullable = false)
    private int breakMinutes;

    /** 기본 프리셋 여부. */
    @Column(name = "is_default", nullable = false)
    @Builder.Default
    private boolean isDefault = false;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    /** 소프트 딜리트 (시드 교체 여지). */
    @Column(name = "deleted_at")
    private Instant deletedAt;
}

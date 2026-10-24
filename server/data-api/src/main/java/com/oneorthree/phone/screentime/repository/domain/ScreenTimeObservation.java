package com.oneorthree.phone.screentime.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

/**
 * 기기 하나가 한 UTC 날짜에 대해 보낸 스크린타임 관측 하나 (GROMO-1769, 회관 기록 LLD §4). 불변 행이다 —
 * 같은 (사용자, 기기, 날짜) 의 최신 선택은 {@code measuredAt} 최댓값이고, 더 오래된 관측은 그 선택을 바꾸지 않는다.
 *
 * <p>측정 날짜는 UTC 기준이며 관측 기록은 보상 판정과 분리한다(LLD §5).
 * {@code minutes} 는 {@code authorized} 일 때만 있다(측정된 0 만 0, RC-P06).
 */
@Entity
@Table(name = "screen_time_observations")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class ScreenTimeObservation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** 서버가 서명한 로그인 세션 id 와 같은 값(2026-09-19 결정 RC-기기) — 앱이 지어낸 기기가 아니다. */
    @Column(name = "device_id", nullable = false)
    private UUID deviceId;

    /** 측정한 UTC 날짜 버킷 — 보낸 날이 아니다(LLD §4). */
    @Column(name = "measured_date", nullable = false)
    private LocalDate measuredDate;

    /** 집계 날짜의 경계. 측정 시각과 창 경계는 UTC instant로 처리한다. */
    @Builder.Default
    @Column(nullable = false, length = 32)
    private String timezone = "UTC";

    @Column(name = "measured_at", nullable = false)
    private Instant measuredAt;

    private Integer minutes;

    /** 하루 전체 측정이 끝났다는 표식. 중간 관측은 통계에만 사용한다. */
    @Column(nullable = false)
    private boolean finalized;

    /** {@code authorized|denied|unavailable|pending} — 공개 계약 문자열 그대로. */
    @Column(name = "measurement_status", nullable = false, length = 12)
    private String measurementStatus;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false,
            columnDefinition = "timestamptz not null default now()")
    private Instant createdAt;

    /** 같은 시각 관측의 내용 비교 — 같으면 무변경 재전송, 다르면 409(RC-P08). */
    public boolean sameMeasurement(Integer otherMinutes, String otherStatus, boolean otherFinalized) {
        return Objects.equals(minutes, otherMinutes) && measurementStatus.equals(otherStatus)
                && finalized == otherFinalized;
    }
}

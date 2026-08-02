package com.oneorthree.phone.group.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 스크린타임 창(TIME_WINDOW×SCREEN_TIME) 사용분 보고 — {@code PUT /groups/{gid}/challenges/{cid}/window-usage}.
 *
 * <p>값은 <b>클라 신뢰</b>다(네이티브 버킷 타임라인을 앱이 창 경계로 집계해 올린다, ±15분 눈금 오차).
 * 서버는 범위(0~1440)만 검증하고 그대로 저장한다 — (챌린지, 유저, 날짜)당 1행 upsert, 마지막 값 승리.
 */
@Getter
@NoArgsConstructor
public class WindowUsageReportRequest {

    /** 보고 대상 날짜(KST 로컬) — 날짜 D 창의 사용분. */
    @NotNull
    private LocalDate date;

    /** 창 내 사용 분(0~1440). 범위 검증은 서비스에서 INVALID_MISSION_PARAMS 로 한다. */
    @NotNull
    private Integer usedMinutes;

    /** 클라 측정 시각(참고용) — 저장 컬럼 없이 로그로만 남긴다(분쟁 추적·시계 왜곡 감지용). */
    private Instant measuredAt;

    /** 테스트 편의 생성자 — 역직렬화 전용 DTO 라 프로덕션 코드는 기본 생성자만 쓴다. */
    public WindowUsageReportRequest(LocalDate date, Integer usedMinutes, Instant measuredAt) {
        this.date = date;
        this.usedMinutes = usedMinutes;
        this.measuredAt = measuredAt;
    }
}

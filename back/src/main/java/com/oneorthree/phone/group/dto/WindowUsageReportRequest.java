package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 스크린타임 창(TIME_WINDOW×SCREEN_TIME) 사용분 보고 — {@code PUT /groups/{gid}/challenges/{cid}/window-usage}.
 *
 * <p>필드명은 신앱 payload {@code {usageDate, progressMinutes, measuredAt}}(LLD §2.1)가 정본이고,
 * 구앱의 {@code {date, usedMinutes}} 는 {@link JsonAlias} 브리지로 이중 수용한다(GROMO-1407) —
 * 서버 먼저 배포되므로 구앱 요청이 깨지면 안 된다.
 *
 * <p>값은 <b>클라 신뢰</b>다(네이티브 버킷 타임라인을 앱이 창 경계로 집계해 올린다, ±15분 눈금 오차).
 * 서버는 범위(0~1440)와 measuredAt 의 미래 여부만 검증한다 — (챌린지, 유저, 날짜)당 1행 upsert,
 * measured_at 단조 갱신(역전 보고는 조용히 무시 — N34).
 */
@Getter
@NoArgsConstructor
public class WindowUsageReportRequest {

    /** 보고 대상 날짜(KST 로컬) — 날짜 D 창의 사용분. 구앱 필드명 {@code date} 수용. */
    @NotNull
    @JsonAlias("date")
    private LocalDate usageDate;

    /** 창 내 사용 분(0~1440). 구앱 필드명 {@code usedMinutes} 수용. 범위 검증은 서비스에서. */
    @NotNull
    @JsonAlias("usedMinutes")
    private Integer progressMinutes;

    /**
     * 클라 측정 시각 — 역전 보고 방어의 비교 축(N34). 서버 시각 +2분 초과는 거절
     * ({@code INVALID_MEASURED_AT} 400). null(구앱)은 저장값이 없을 때만 반영된다.
     */
    private Instant measuredAt;

    /** 테스트 편의 생성자 — 역직렬화 전용 DTO 라 프로덕션 코드는 기본 생성자만 쓴다. */
    public WindowUsageReportRequest(LocalDate usageDate, Integer progressMinutes, Instant measuredAt) {
        this.usageDate = usageDate;
        this.progressMinutes = progressMinutes;
        this.measuredAt = measuredAt;
    }
}

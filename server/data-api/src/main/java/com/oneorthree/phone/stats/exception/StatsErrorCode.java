package com.oneorthree.phone.stats.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 통계 도메인의 실패 사유. 각 값이 HTTP 상태와 사용자 노출 문구를 함께 들고 있어, 던지는 쪽이 상태 코드를
 * 고르지 않는다.
 */
@Getter
public enum StatsErrorCode implements ErrorCode {

    INVALID_DATE_RANGE(HttpStatus.BAD_REQUEST, "유효하지 않은 날짜 범위입니다."),

    // ── 회관 기록(GROMO-1769, island-records LLD §6) ──

    /** 집중 기록 다음 페이지의 스냅샷이 만료·파기됐다 — 첫 페이지부터 다시 읽는다. */
    STATISTICS_SNAPSHOT_EXPIRED(HttpStatus.CONFLICT, "기록 목록이 만료됐습니다. 처음부터 다시 불러와 주세요."),

    /** 측정 기기가 이 로그인 세션이 아니다 — 임의 deviceId 를 새 기기로 받지 않는다(RC-P09). */
    SCREEN_TIME_DEVICE_FORBIDDEN(HttpStatus.FORBIDDEN, "이 기기에서 보낸 측정만 저장할 수 있습니다."),

    /** 같은 기기·날짜·시각의 관측이 이미 다른 내용으로 있다 — 첫 확정 관측을 보존한다(RC-P08). */
    SCREEN_TIME_MEASUREMENT_CONFLICT(HttpStatus.CONFLICT, "같은 시각의 다른 측정이 이미 있습니다."),

    /** 관측 시각이 그 날짜보다 이르거나 미래이거나, 그 날짜의 보고 마감이 지났다(RC-D04). */
    SCREEN_TIME_OUT_OF_WINDOW(HttpStatus.UNPROCESSABLE_ENTITY, "보고할 수 있는 측정 시각이 아닙니다.");

    private final HttpStatus status;
    private final String message;

    StatsErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

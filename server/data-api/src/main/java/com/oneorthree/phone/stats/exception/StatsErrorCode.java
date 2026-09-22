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
    SCREEN_TIME_OUT_OF_WINDOW(HttpStatus.UNPROCESSABLE_ENTITY, "보고할 수 있는 측정 시각이 아닙니다."),

    /** 통계 scope 가 {@code me|island} 가 아니다 — Business 가 먼저 거르지만 Data 도 값 범위로 판정한다. */
    STATISTICS_SCOPE_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "지원하지 않는 조회 범위입니다."),

    /**
     * 측정 상태가 허용값이 아니거나 분 값이 상태와 맞지 않는다(authorized 만 0~1440, 나머지는 null) — DB CHECK 위반이
     * 500 으로 새지 않게 저장 전에 판정한다.
     */
    SCREEN_TIME_INVALID_MEASUREMENT(HttpStatus.UNPROCESSABLE_ENTITY, "측정 상태나 사용 시간이 올바르지 않습니다."),

    // ── 주간 섬 랭킹(GROMO-1997, island-rankings LLD §6) ──

    /**
     * {@code week} 가 그 주를 가리키는 식별자가 아니다 — UTC 일요일이 아니거나 아직 오지 않은 주다
     * ({@code RankingWeek}). 모양(날짜 형식)은 Business 가 400 으로 먼저 거르고, 달력 의미는 여기서 판정한다.
     */
    RANKING_WEEK_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "조회할 수 있는 주가 아닙니다.");

    private final HttpStatus status;
    private final String message;

    StatsErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

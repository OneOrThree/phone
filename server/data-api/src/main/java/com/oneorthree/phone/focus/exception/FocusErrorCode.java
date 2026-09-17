package com.oneorthree.phone.focus.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * focus 도메인 실패 사유 — HTTP 상태와 사용자 노출 문구를 한 곳에 묶는다.
 *
 * <p>같은 상태여도 코드를 나눈 곳이 있다: 409 는 {@code SESSION_ALREADY_ENDED}(통계·지급이 이미 커밋됐으니
 * 재시도 금지)와 {@code SESSION_DISCARDED}(통계에 한 번도 반영되지 않았으니 POST 로 살려 올려도 된다)로
 * 갈린다 — 앱의 폴백 여부가 여기서 결정되므로 둘을 합치면 그 블록의 집중 시간과 코인이 유실된다.
 */
@Getter
public enum FocusErrorCode implements ErrorCode {

    TAG_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 태그입니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "권한이 없습니다."),
    INVALID_DATE_RANGE(HttpStatus.BAD_REQUEST, "유효하지 않은 기간입니다."),
    INVALID_PAGE_REQUEST(HttpStatus.BAD_REQUEST, "유효하지 않은 페이지 요청입니다."),
    SESSION_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 집중 세션입니다."),
    SESSION_ALREADY_ENDED(HttpStatus.CONFLICT, "이미 종료된 집중 세션입니다."),
    // GROMO-1214 코드리뷰: 취소(CANCELED)·자동마감(AUTO_CLOSED) 마커의 종료 시도. 같은 409지만 위와 의미가 다르다 —
    // 저쪽은 '통계·지급이 이미 커밋됨'(재시도 금지)이고, 이쪽은 '이 마커는 통계에 한 번도 반영되지 않았음'이다.
    // 앱은 이 코드를 보고 그 시간을 POST /focus-session 으로 살려 올린다(폴백해도 이중 지급이 아니다).
    SESSION_DISCARDED(HttpStatus.CONFLICT, "취소·자동마감된 집중 세션입니다."),
    OCCUPATION_REQUIRED(HttpStatus.BAD_REQUEST, "직업 정보가 없습니다."),
    OCCUPATION_TAG_NOT_RENAMABLE(HttpStatus.BAD_REQUEST, "직군 프리셋 태그는 이름을 변경할 수 없습니다."),

    // ── GROMO-1764: 집중 세션 수명주기(v0.3) ──────────────────────────────────
    /** subject 누락·공백·길이 초과(기술 상한, FR-D06 최종 범위는 미결). */
    INVALID_SUBJECT(HttpStatus.BAD_REQUEST, "집중 주제가 올바르지 않습니다."),
    /** targetMinutes가 정수가 아니거나 0 이하 — FR-D06의 최종 허용 범위는 아직 정해지지 않았다. */
    INVALID_TARGET_MINUTES(HttpStatus.BAD_REQUEST, "목표 시간이 올바르지 않습니다."),
    /** {@code date} 쿼리 파라미터의 구문 오류(패턴 불일치) — policy.md "타입/구문 오류는 400". */
    INVALID_SUMMARY_DATE(HttpStatus.BAD_REQUEST, "날짜 형식이 올바르지 않습니다."),
    /** 패턴은 맞지만 실존하지 않는 날짜(예: 2월 30일) — policy.md "명시한 잘못된 날짜는 422". */
    SUMMARY_DATE_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "존재하지 않는 날짜입니다."),
    /** {@code timezone}이 없거나 "Asia/Seoul"이 아님 — policy.md, 이 API는 그 값만 허용한다. */
    INVALID_SUMMARY_TIMEZONE(HttpStatus.BAD_REQUEST, "지원하지 않는 timezone입니다."),
    /** 요청 islandId가 사용자의 현재 소속 섬이 아니다(FR-P03) — 시작은 현재 섬에서만 가능하다. */
    ISLAND_NOT_CURRENT(HttpStatus.FORBIDDEN, "현재 소속된 섬이 아닙니다."),
    /** 현재 섬의 활성 멤버가 아니다. */
    ISLAND_MEMBERSHIP_REQUIRED(HttpStatus.FORBIDDEN, "섬 멤버만 집중을 시작할 수 있습니다."),
    /** 이미 진행(active/paused) 중인 세션이 있다 — 새/구 프로토콜을 가리지 않고 막는다(LLD §5). */
    SESSION_IN_PROGRESS(HttpStatus.CONFLICT, "이미 진행 중인 집중 세션이 있습니다."),
    /** pause/resume/finish 요청 본문에 expectedVersion이 없다(FR-P07 필수). */
    EXPECTED_VERSION_REQUIRED(HttpStatus.BAD_REQUEST, "expectedVersion은 필수입니다."),
    /** pause/resume/finish의 lifecycle 불일치 또는 expectedVersion 불일치(FR-P07). */
    SESSION_STATE_CONFLICT(HttpStatus.CONFLICT, "지금 상태에서는 처리할 수 없습니다."),
    /**
     * 보상 정책(FR-D01~06) 미확정 — {@link com.oneorthree.phone.focus.support.FocusRewardPolicyGate}가
     * 닫혀 있는 동안 finish는 이 코드로 막힌다. "0원 지급 성공"으로 위장하지 않는다(policy.md).
     */
    REWARD_POLICY_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "보상 정책이 아직 준비되지 않았습니다.");

    private final HttpStatus status;
    private final String message;

    FocusErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

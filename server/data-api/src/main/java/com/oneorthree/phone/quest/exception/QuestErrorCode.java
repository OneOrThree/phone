package com.oneorthree.phone.quest.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 섬 퀘스트 도메인의 실패 코드 (GROMO-1773, LLD §1). 앱이 {@code code} 문자열로 분기하므로 상수 이름은
 * 계약이다. Business 가 공개 봉투(FORBIDDEN·NOT_FOUND·OUT_OF_RANGE…)로 옮길 때 field 를 붙인다 —
 * 범위 위반을 필드별 코드로 가르는 것은 그 field 를 정하기 위해서다.
 */
@Getter
public enum QuestErrorCode implements ErrorCode {

    /** 방장이 아닌 주민의 생성·수정(D3). */
    QUEST_FORBIDDEN(HttpStatus.FORBIDDEN, "방장만 퀘스트를 만들거나 고칠 수 있습니다."),

    /** 게시판 미완공 — 퀘스트는 게시판 기능이다(LLD §1 시설 해금). */
    QUEST_BOARD_LOCKED(HttpStatus.FORBIDDEN, "게시판을 먼저 지어야 합니다."),

    /** 경로의 섬에 없는 퀘스트. */
    QUEST_NOT_FOUND(HttpStatus.NOT_FOUND, "퀘스트를 찾을 수 없습니다."),

    /** 경로의 퀘스트에 없거나 이미 지난(현재가 아닌) 회차. */
    QUEST_OCCURRENCE_NOT_FOUND(HttpStatus.NOT_FOUND, "퀘스트 회차를 찾을 수 없습니다."),

    /** 필수 필드 누락·형식 오류·종류와 맞지 않는 창 필드. */
    QUEST_INVALID_REQUEST(HttpStatus.BAD_REQUEST, "퀘스트 요청 형식이 올바르지 않습니다."),

    /** timezone 은 생략 또는 UTC 만(결정 Q-6). */
    QUEST_INVALID_TIMEZONE(HttpStatus.BAD_REQUEST, "지원하지 않는 시간대입니다."),

    /**
     * 아직 받지 않는 종류 — screen 퀘스트. 스크린타임 하루 값({@code daily_screen_time_stats.date})이 KST 라벨이라
     * UTC 회차와 9시간 어긋나므로 날짜 축 UTC 전환(1930) 전까지 생성·수정하지 않는다(결정 Q-6 보완).
     */
    QUEST_TYPE_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "지금은 만들 수 없는 퀘스트 종류입니다."),

    QUEST_TITLE_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "퀘스트 이름 길이가 허용 범위를 벗어났습니다."),

    QUEST_TARGET_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "목표 시간이 허용 범위를 벗어났습니다."),

    /** 창 시작 ≥ 끝(자정 넘는 창 포함) — 회차가 UTC 하루라 창이 날을 넘을 수 없다. */
    QUEST_WINDOW_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "집중 시간대가 허용 범위를 벗어났습니다."),

    /** claim 의 expectedVersion 불일치 — 지급 없음. */
    QUEST_VERSION_CONFLICT(HttpStatus.CONFLICT, "다른 변경이 먼저 반영됐습니다."),

    /** 미달성·측정 대기·이미 정산·수령 기한 지남 — 지급 없음(LLD §5 2~3단계). */
    QUEST_STATE_CONFLICT(HttpStatus.CONFLICT, "지금 상태에서는 보상을 받을 수 없습니다."),

    /** 생성 스위치가 닫힘(policy.md 출시 조건) — 정산 게이트와 여는 조건이 달라 코드를 가른다. */
    QUEST_CREATION_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "퀘스트 만들기를 아직 사용할 수 없습니다."),

    /** 정산 스위치가 닫힘(policy.md 출시 조건). */
    QUEST_SETTLEMENT_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "퀘스트 보상 받기를 아직 사용할 수 없습니다.");

    private final HttpStatus status;
    private final String message;

    QuestErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

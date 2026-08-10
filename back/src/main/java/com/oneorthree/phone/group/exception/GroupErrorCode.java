package com.oneorthree.phone.group.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum GroupErrorCode {
    // 권한
    GUEST_FORBIDDEN(HttpStatus.FORBIDDEN, "게스트는 이 작업을 수행할 권한이 없습니다."),
    NOT_OWNER(HttpStatus.FORBIDDEN, "그룹장만 수행할 수 있습니다."),
    MEMBER_ONLY(HttpStatus.FORBIDDEN, "그룹원만 조회할 수 있습니다."),

    // 잘못된 입력 및 요청
    INVALID_MISSION_PARAMS(HttpStatus.BAD_REQUEST, "미션 파라미터가 유효하지 않습니다."),
    // 내기 히스토리 페이지네이션(GROMO-1207) — FocusErrorCode.INVALID_PAGE_REQUEST 와 같은 성격.
    INVALID_PAGE_REQUEST(HttpStatus.BAD_REQUEST, "유효하지 않은 페이지 요청입니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "원하는 그룹을 찾을 수 없습니다."),
    WRONG_PASSWORD(HttpStatus.UNAUTHORIZED, "비밀번호가 일치하지 않습니다."),

    // 비즈니스 로직상 에러,
    ALREADY_MEMBER(HttpStatus.CONFLICT, "이미 참여 중인 그룹입니다."),
    ROOM_FULL(HttpStatus.CONFLICT, "그룹 정원이 가득 찼습니다."),
    HOST_WITHDRAW(HttpStatus.BAD_REQUEST, "방장 위임 후 탈퇴할 수 있습니다."),
    MAX_MEMBERS_TOO_SMALL(HttpStatus.BAD_REQUEST, "그룹에 참여중인 인원이 더 많습니다."),
    // A-0/A-3 소프트삭제·강퇴 — 앱이 응답의 code 문자열로 분기할 수 있으니 이름 신중히.
    // (대상 멤버 없음은 기존 NOT_FOUND 재사용 — transferOwner 와 동일 패턴)
    KICKED_CANNOT_REJOIN(HttpStatus.FORBIDDEN, "강퇴된 그룹에는 다시 참여할 수 없어요"),
    CANNOT_KICK_SELF(HttpStatus.BAD_REQUEST, "자기 자신은 내보낼 수 없어요"),
    // deprecated — 발급 경로 없음(챌린지 생성 중복은 CHALLENGE_DUPLICATE). 하루형만 카테고리당 1개라는
    // 새 규칙(GROMO-1422)에 맞춰 카피만 정정해 잔존시킨다(코드 문자열 호환 관례).
    ACTIVE_CHALLENGE_EXISTS(HttpStatus.CONFLICT, "해당 카테고리에 이미 활성 하루형 챌린지가 존재합니다."),
    // 앱이 응답의 code 문자열(GROUP_LIMIT_EXCEEDED)로 분기한다 — 이름 변경 금지.
    GROUP_LIMIT_EXCEEDED(HttpStatus.CONFLICT, "참여할 수 있는 그룹 수를 초과했어요"),
    NOTICE_FORBIDDEN(HttpStatus.FORBIDDEN, "공지 작성/수정/삭제 권한이 없습니다."),

    // 챌린지 내기 — 앱이 응답의 code 문자열(BET_*)로 분기한다. 이름 변경 금지.
    // deprecated — 내기 대상이 전 조합(FOCUS·SCREEN_TIME × DURATION·TIME_WINDOW)으로 확대돼 더는 발급하지
    // 않는다. 구앱이 이 코드 문자열로 분기하고 있어 값만 잔존시킨다(이름 변경 금지 규칙).
    BET_FOCUS_ONLY(HttpStatus.BAD_REQUEST, "집중 시간 챌린지에만 내기를 걸 수 있어요"),
    BET_INVALID_STAKE(HttpStatus.BAD_REQUEST, "참가비는 1~1,000코인 사이로 입력해 주세요"),
    BET_NOT_FOUND(HttpStatus.NOT_FOUND, "내기를 찾을 수 없어요"),
    // 문구는 날짜 중립 — 내일 내기(GROMO-1103)·취소 후 재개설(GROMO-1201)이 생기며 "오늘"이 틀려졌다.
    BET_ALREADY_EXISTS(HttpStatus.CONFLICT, "이 날짜에는 이미 내기가 있어요"),
    BET_CLOSED(HttpStatus.CONFLICT, "참가할 수 있는 시간이 지났어요"),
    BET_ALREADY_JOINED(HttpStatus.CONFLICT, "이미 참가한 내기예요"),
    BET_ALREADY_ACHIEVED(HttpStatus.CONFLICT, "이미 목표를 달성해서 참가할 수 없어요"),
    // 스크린타임 내기 전용 가드 — 달성이 하루/창 끝에야 확정되므로 "이미 달성"(무위험)은 성립하지 않는다.
    // 반대로 이미 목표를 초과한 유저는 패배가 확정이라 판돈 투입을 막는다.
    BET_ALREADY_FAILED(HttpStatus.CONFLICT, "이미 목표 시간을 넘겨서 참가할 수 없어요"),
    BET_CHALLENGE_INACTIVE(HttpStatus.CONFLICT, "종료된 챌린지에는 내기를 걸 수 없어요"),
    CHALLENGE_HAS_OPEN_BET(HttpStatus.CONFLICT, "진행 중인 내기가 있어 삭제할 수 없어요"),
    BET_CANCEL_FORBIDDEN(HttpStatus.FORBIDDEN, "내기는 개설자만 취소할 수 있어요"),
    BET_CANCEL_HAS_OTHERS(HttpStatus.CONFLICT, "다른 참가자가 있어 취소할 수 없어요"),
    // BET_CLOSED(참가 마감 — 날짜 경과 포함)와 구분되는 취소 전용 코드: "내기가 OPEN 이 아니다"만
    // 뜻한다(이중 취소·정산과의 CAS 레이스 패배). 앱 취소 버튼이 별도 문구로 분기한다.
    BET_NOT_OPEN(HttpStatus.CONFLICT, "이미 종료된 내기예요"),
    // 참가 철회(leave, GROMO-1102) 전용 — 앱이 응답의 code 문자열로 분기한다. 이름 변경 금지.
    BET_NOT_JOINED(HttpStatus.CONFLICT, "참가하지 않은 내기예요"),
    // "시작 이후"의 철회 거절. BET_NOT_OPEN(상태 위반)과 구분되는 시각 위반 전용 코드다.
    BET_LEAVE_CLOSED(HttpStatus.CONFLICT, "내기가 시작되어 철회할 수 없어요"),

    // 챌린지 생성 충돌 — 앱이 응답의 code 문자열로 분기한다. 이름 변경 금지.
    // 하루형(DURATION)만 카테고리당 활성 1개(FR-3 · V36 부분 유니크) — 창형은 겹치지 않으면 복수 허용이라
    // 이 코드는 하루형 중복에서만 나간다(GROMO-1422).
    CHALLENGE_DUPLICATE(HttpStatus.CONFLICT, "이미 같은 카테고리의 하루형 챌린지가 진행 중이에요"),
    // 활성 창형끼리 시간대 교차 금지(카테고리 무관, §A5) — 같은 시간대 행동 하나로 내기 2개 중복 보상 차단.
    CHALLENGE_WINDOW_OVERLAP(HttpStatus.CONFLICT, "겹치는 시간대의 챌린지가 이미 있어요"),
    // 그룹당 활성 챌린지 4개 상한(FR-1 · §A4 · GROMO-1422) — 사전 검사 + 그룹 행 배타 락으로 결정적 409.
    CHALLENGE_LIMIT_EXCEEDED(HttpStatus.CONFLICT, "활성 챌린지는 그룹당 최대 4개까지 만들 수 있어요"),
    // 요일 반복(§A3) — 기본값 없음: 신앱이 빈 배열을 보내면 거절한다(필드 미전송 구앱만 매일로 접는다).
    CHALLENGE_REPEAT_DAYS_REQUIRED(HttpStatus.BAD_REQUEST, "챌린지가 도는 요일을 1개 이상 선택해 주세요"),
    // 창형 SCREEN_TIME 목표는 15분 배수(§A6-3) — 스크린타임 측정 눈금이 15분이라 그보다 곱지 않다.
    CHALLENGE_GOAL_NOT_ALIGNED(HttpStatus.BAD_REQUEST, "스크린타임 창 목표는 15분 단위로 입력해 주세요"),
    // 종료는 진행 중(OPEN 회차 존재) 불가(FR-11 · §A8) — 남의 돈이 걸린 회차를 대가 없이 마감하는 경로 차단.
    CHALLENGE_END_BLOCKED(HttpStatus.CONFLICT, "진행 중인 내기 회차가 끝나야 종료할 수 있어요"),

    // 동시성 — 낙관락(@Version: Group 정원·UserWallet 잔액) 충돌의 전역 폴백(GlobalExceptionHandler).
    // 트랜잭션 전체가 롤백된 일시 충돌이라 클라이언트가 재시도하면 풀린다. 구앱은 이 코드를 모르므로
    // 공통 재시도 문구로 강하한다 — 의미가 같아 안전하다.
    CONCURRENT_UPDATE(HttpStatus.CONFLICT, "잠시 후 다시 시도해주세요"),

    // 수동 배치 트리거 관리자 키 (local/dev/staging 전용 — GroupBetBatchController)
    BATCH_KEY_NOT_CONFIGURED(HttpStatus.SERVICE_UNAVAILABLE, "관리자 키가 설정되지 않아 수동 트리거를 사용할 수 없습니다."),
    BATCH_KEY_INVALID(HttpStatus.FORBIDDEN, "관리자 키가 올바르지 않습니다."),

    // 서버 에러
    CODE_GENERATION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "현재 참여 인원보다 적게 정원을 설정할 수 없습니다.");

    private final HttpStatus status;
    private final String message;

    GroupErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

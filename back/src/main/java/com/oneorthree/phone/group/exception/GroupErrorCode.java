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
    NOT_FOUND(HttpStatus.NOT_FOUND, "원하는 그룹을 찾을 수 없습니다."),
    WRONG_PASSWORD(HttpStatus.UNAUTHORIZED, "비밀번호가 일치하지 않습니다."),

    // 비즈니스 로직상 에러,
    ALREADY_MEMBER(HttpStatus.CONFLICT, "이미 참여 중인 그룹입니다."),
    ROOM_FULL(HttpStatus.CONFLICT, "그룹 정원이 가득 찼습니다."),
    HOST_WITHDRAW(HttpStatus.BAD_REQUEST, "방장 위임 후 탈퇴할 수 있습니다."),
    MAX_MEMBERS_TOO_SMALL(HttpStatus.BAD_REQUEST, "그룹에 참여중인 인원이 더 많습니다."),
    ACTIVE_CHALLENGE_EXISTS(HttpStatus.CONFLICT, "해당 카테고리에 이미 활성 챌린지가 존재합니다."),
    // 앱이 응답의 code 문자열(GROUP_LIMIT_EXCEEDED)로 분기한다 — 이름 변경 금지.
    GROUP_LIMIT_EXCEEDED(HttpStatus.CONFLICT, "참여할 수 있는 그룹 수를 초과했어요"),
    NOTICE_FORBIDDEN(HttpStatus.FORBIDDEN, "공지 작성/수정/삭제 권한이 없습니다."),

    // 챌린지 내기 — 앱이 응답의 code 문자열(BET_*)로 분기한다. 이름 변경 금지.
    BET_FOCUS_ONLY(HttpStatus.BAD_REQUEST, "집중 시간 챌린지에만 내기를 걸 수 있어요"),
    BET_INVALID_STAKE(HttpStatus.BAD_REQUEST, "선택할 수 없는 판돈이에요"),
    BET_NOT_FOUND(HttpStatus.NOT_FOUND, "내기를 찾을 수 없어요"),
    BET_ALREADY_EXISTS(HttpStatus.CONFLICT, "오늘 이 챌린지에는 이미 내기가 있어요"),
    BET_CLOSED(HttpStatus.CONFLICT, "참가할 수 있는 시간이 지났어요"),
    BET_ALREADY_JOINED(HttpStatus.CONFLICT, "이미 참가한 내기예요"),
    BET_ALREADY_ACHIEVED(HttpStatus.CONFLICT, "이미 목표를 달성해서 참가할 수 없어요"),
    BET_CHALLENGE_INACTIVE(HttpStatus.CONFLICT, "종료된 챌린지에는 내기를 걸 수 없어요"),
    CHALLENGE_HAS_OPEN_BET(HttpStatus.CONFLICT, "진행 중인 내기가 있어 삭제할 수 없어요"),

    // 서버 에러
    CODE_GENERATION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "현재 참여 인원보다 적게 정원을 설정할 수 없습니다.");

    private final HttpStatus status;
    private final String message;

    GroupErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

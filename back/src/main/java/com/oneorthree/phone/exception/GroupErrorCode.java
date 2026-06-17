package com.oneorthree.phone.exception;

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

    // 비즈니스 로직상 에러
    ALREADY_MEMBER(HttpStatus.CONFLICT, "이미 참여 중인 그룹입니다."),
    ROOM_FULL(HttpStatus.CONFLICT, "그룹 정원이 가득 찼습니다."),
    HOST_WITHDRAW(HttpStatus.BAD_REQUEST, "방장 위임 후 탈퇴할 수 있습니다."),

    // 서버 에러
    CODE_GENERATION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "방 코드 생성에 실패했습니다.");

    private final HttpStatus status;
    private final String message;

    GroupErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

package com.oneorthree.phone.user.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum UserErrorCode {

    /**
     * <b>지목된 유저</b>가 없다 — 요청자가 아니라 요청이 가리킨 대상(위임 대상·강퇴 대상 등).
     * 앱이 응답의 code 문자열("NOT_FOUND")로 분기한다 — 삭제·개명 금지(GroupErrorCode 규율과 동일).
     *
     * <p>GROMO-1247: {@code group/} 계열의 <b>요청자</b> 부재는 {@link #USER_NOT_FOUND} 로 분리했다.
     * 나머지 도메인(user·focus·currency·item·stats·friend·auth·screentime·character)은 아직 이
     * 코드가 요청자 부재도 함께 뜻한다 — 후속 티켓에서 같은 방식으로 갈라낸다.
     */
    NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 유저입니다."),
    /**
     * <b>요청자 본인</b>의 활성 유저 행이 없다 — 탈퇴/비활성 계정의 유효 JWT 로 들어온 요청.
     * 그룹·챌린지 부재({@code GroupErrorCode.NOT_FOUND})와 같은 404 지만 <b>탈출구가 다르다</b>:
     * 재시도로 절대 풀리지 않고 재로그인만이 답이라, 앱이 "사라진 그룹이에요" 대신 로그인 유도로
     * 분기할 수 있게 code 를 갈랐다(GROMO-1247). 앱이 code 문자열로 분기한다 — 이름 변경 금지.
     *
     * <p><b>대상 유저 부재에는 쓰지 말 것</b> — 방장이 없는 멤버를 지목한 것은 내 세션이 죽은 게
     * 아니다. 그쪽은 {@link #NOT_FOUND} 를 그대로 쓴다.
     */
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "로그인 정보가 만료됐어요. 다시 로그인해 주세요."),
    SOCIAL_ACCOUNT_NOT_FOUND(HttpStatus.NOT_FOUND, "연동되지 않은 소셜 계정입니다."),
    LAST_SOCIAL_ACCOUNT(HttpStatus.CONFLICT, "마지막 소셜 연동은 해제할 수 없습니다."),
    NICKNAME_DUPLICATE(HttpStatus.CONFLICT, "이미 사용 중인 닉네임입니다."),
    NICKNAME_INVALID(HttpStatus.BAD_REQUEST, "닉네임은 앞뒤 공백 제외 2~10자여야 합니다."),
    OCCUPATION_NOT_AVAILABLE(HttpStatus.BAD_REQUEST, "선택할 수 없는 직업입니다.");

    private final HttpStatus status;
    private final String message;

    UserErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

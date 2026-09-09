package com.oneorthree.phone.user.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * user 도메인 실패 사유 — HTTP 상태와 사용자 노출 문구를 한 곳에 묶는다.
 *
 * <p><b>앱이 code 문자열로 분기하므로 상수 이름은 계약</b>이다. 개명·삭제는 앱을 깨뜨린다.
 * 특히 404 가 둘로 갈려 있다 — {@code TARGET_USER_NOT_FOUND}(요청이 <b>지목한</b> 유저가 없음)와
 * {@code USER_NOT_FOUND}(<b>요청자 본인</b>의 활성 계정이 없음)는 탈출구가 다르다.
 * 앞은 화면에서 처리할 일이고, 뒤는 재시도로 풀리지 않아 재로그인만이 답이다.
 */
@Getter
public enum UserErrorCode implements ErrorCode {

    /**
     * <b>지목된 유저</b>가 없다 — 요청자가 아니라 요청이 가리킨 대상(위임 대상·강퇴 대상·친구·공개 프로필).
     * 지갑·설정처럼 유저에 딸린 1:1 행의 부재도 여기다(가입 시 함께 생기므로 없다면 그 유저가 없는 것).
     * {@link #USER_NOT_FOUND} 와 달리 <b>로그아웃하면 안 된다</b> — 남의 계정이 사라진 것이다.
     *
     * <p>GROMO-1725: 종전 {@link #NOT_FOUND} 가 {@code GroupErrorCode.NOT_FOUND} 와 같은 문자열이라
     * 앱이 유저 부재를 «그룹이 사라짐»으로 해석했다. 이름을 갈라 새로 낸다. 요청자 부재는 전 도메인이
     * {@code UserQueryService.getCaller*}(→ {@link #USER_NOT_FOUND}) 로 옮겨 갔다.
     */
    TARGET_USER_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 유저입니다."),
    /**
     * @deprecated 발급 경로 없음 (GROMO-1725). 요청자 부재는 {@link #USER_NOT_FOUND}, 지목 대상 부재는
     * {@link #TARGET_USER_NOT_FOUND}. 앱이 code 문자열 "NOT_FOUND" 로 분기하는 코드가 남아 있어 값만
     * 잔존시킨다(코드 문자열 호환 관례 — {@code GroupErrorCode.ACTIVE_CHALLENGE_EXISTS} 와 같음).
     */
    @Deprecated
    NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 유저입니다."),
    /**
     * <b>요청자 본인</b>의 활성 유저 행이 없다 — 탈퇴/비활성 계정의 유효 JWT 로 들어온 요청.
     * 그룹·챌린지 부재({@code GroupErrorCode.NOT_FOUND})와 같은 404 지만 <b>탈출구가 다르다</b>:
     * 재시도로 절대 풀리지 않고 재로그인만이 답이라, 앱이 "사라진 그룹이에요" 대신 로그인 유도로
     * 분기할 수 있게 code 를 갈랐다(GROMO-1247). 앱이 code 문자열로 분기한다 — 이름 변경 금지.
     *
     * <p><b>대상 유저 부재에는 쓰지 말 것</b> — 방장이 없는 멤버를 지목한 것은 내 세션이 죽은 게
     * 아니다. 그쪽은 {@link #TARGET_USER_NOT_FOUND} 다.
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

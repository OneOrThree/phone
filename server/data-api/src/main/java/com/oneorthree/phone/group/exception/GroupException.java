package com.oneorthree.phone.group.exception;

/**
 * 그룹 도메인의 단일 예외 — 상태 코드와 문구는 전부 {@link GroupErrorCode} 가 들고 있다.
 *
 * <p>실패 종류가 늘어도 예외 클래스는 늘리지 않고 코드를 늘린다. 핸들러가 하나뿐이라 코드만
 * 추가하면 응답 형태가 저절로 맞기 때문이다 — 재시도 지연 힌트처럼 <b>코드 밖의 데이터</b>를
 * 함께 실어야 할 때만 하위 클래스를 만든다({@link ChallengeResultClaimHeldException}).
 */
public class GroupException extends RuntimeException {
    /**
     * 응답의 HTTP 상태·에러 코드·문구를 한꺼번에 정하는 값. 던진 뒤에는 바뀌지 않는다.
     */
    private final GroupErrorCode errorCode;

    /**
     * @param errorCode 응답으로 나갈 실패 종류 — 예외 message 도 이 코드의 문구를 그대로 쓴다
     */
    public GroupException(GroupErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    /**
     * @return 핸들러가 상태 코드와 응답 바디를 만들 때 읽는 값. 항상 non-null 이다.
     */
    public GroupErrorCode getErrorCode() {
        return errorCode;
    }
}

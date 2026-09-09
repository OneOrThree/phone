package com.oneorthree.phone.common.exception;

/**
 * 도메인 예외의 공통 베이스 (GROMO-1657) — 각 도메인의 {@code XxxException} 이 상속한다.
 *
 * <p>하는 일은 하나다: {@link ErrorCode} 를 실어 나른다. HTTP 상태·{@code code}·문구는 전부
 * 코드가 들고 있고, 전역 핸들러는 {@link #getErrorCode()} 만 보고 응답을 만든다. 그래서 이
 * 베이스를 상속하는 순간 핸들러 등록 없이 봉투에 실린다.
 *
 * <p><b>하위 클래스는 자기 타입의 {@code errorCode} 필드를 그대로 둔다.</b> {@code getErrorCode()}
 * 를 공변 반환({@code UserErrorCode getErrorCode()})으로 좁혀 두면 호출부·테스트가 도메인 상수와
 * 직접 비교하는 코드가 그대로 산다. 이 베이스는 그 좁힌 getter 를 {@link ErrorCode} 로 올려 받을
 * 뿐이다.
 *
 * <p>메시지는 코드의 문구를 그대로 쓴다 — 예외를 만들 때 문구를 따로 주는 생성자는 두지 않는다.
 * 그 자유를 열면 같은 code 가 호출부마다 다른 문장으로 나가고, 앱은 code 로만 분기하니 문구 차이는
 * 감지도 안 된다.
 */
public abstract class DomainException extends RuntimeException {

    /**
     * @param errorCode 실패 사유. 상태·문구·앱 분기 코드가 전부 여기서 나온다
     */
    protected DomainException(ErrorCode errorCode) {
        super(errorCode.getMessage());
    }

    /**
     * 이 실패의 사유. 하위 클래스가 자기 enum 타입으로 좁혀 반환한다.
     *
     * @return 상태·문구를 결정하는 코드 — {@code null} 이면 안 된다
     */
    public abstract ErrorCode getErrorCode();
}

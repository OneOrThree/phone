package com.oneorthree.business.common.exception;

/**
 * 상류가 코드 없는 4xx(400 · 404 · 415 …)를 줬다 — <b>우리 요청이나 배포가 어긋났다</b>는 신호다.
 *
 * <p>사용자 입력 탓으로 접지 않는 이유: 그러면 엔드포인트가 사라진 배선 사고가 「잘못된 요청」이라는
 * 조용한 400 으로 나타나 아무도 원인을 못 찾는다. 502 로 올려 배포 문제로 보이게 한다(㉹ 의
 * 제공자 선배포·소비자 후배포가 깨진 자리를 드러낸다).
 */
public class UpstreamContractMismatchException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public UpstreamContractMismatchException(String message) {
        super(message);
    }
}

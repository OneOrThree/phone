package com.oneorthree.realtime.common.exception;

/**
 * 상류(Data API) 에 물어봐야 답이 나오는데 물어보지 못했을 때.
 *
 * <p>«아니오»가 아니라 «모르겠다»를 나타낸다. 이 둘을 같은 값으로 뭉개면 상류 장애가 곧
 * «전원 비멤버» 로 읽히거나(전부 막힘) «전원 멤버» 로 읽힌다(전부 샘) — 어느 쪽도 조용하다.
 * 별도 타입으로 세워 두면 호출부가 어느 쪽으로 접을지 명시적으로 고르게 된다.
 */
public class UpstreamUnavailableException extends DomainException {

    public UpstreamUnavailableException() {
        super(CommonErrorCode.UPSTREAM_UNAVAILABLE);
    }
}

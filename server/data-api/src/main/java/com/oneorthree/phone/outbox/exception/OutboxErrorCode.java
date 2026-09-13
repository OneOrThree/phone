package com.oneorthree.phone.outbox.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 내구 이벤트·명령 기반의 실패 사유 (GROMO-1659/1660 공통).
 *
 * <p>이름은 응답 {@code code} 로 그대로 나가 앱·Business 가 분기에 쓴다 — 변경 금지(규약 §7).
 */
@Getter
public enum OutboxErrorCode implements ErrorCode {

    /**
     * 같은 멱등 키로 <b>다른 본문</b>이 왔다. 키를 재사용한 별개 명령이 남의 응답을 재생받으면
     * 「보냈는데 안 만들어졌다」가 되므로 조용히 재생하지 않고 거부한다.
     */
    IDEMPOTENCY_KEY_CONFLICT(HttpStatus.CONFLICT, "같은 요청 키로 다른 요청이 이미 처리되었습니다."),

    /** 지원하지 않는 공개 명령 결과 계약. 키를 제거하거나 원 명령을 재실행하지 않는다. */
    PUBLIC_COMMAND_CONTRACT_UNSUPPORTED(HttpStatus.CONFLICT, "이전 요청 결과의 계약 버전을 지원하지 않습니다."),

    /** 저장된 응답을 요청한 타입으로 되살리지 못했다 — 명령의 응답 타입이 배포 사이에 바뀐 경우다. */
    IDEMPOTENT_REPLAY_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "이전 요청 결과를 복원하지 못했습니다."),

    /**
     * 빠른 완료표시 대상이 없다 — 그런 명령이 없거나, <b>요청자의 것이 아니거나</b>, 그 명령에 알림
     * 대상이 없다. 셋을 한 코드로 합치는 것은 의도다: 남의 명령 id 를 찔러 「있는지 없는지」를
     * 알아낼 수 있으면 그 자체가 노출이다.
     */
    OUTBOX_DELIVERY_NOT_FOUND(HttpStatus.NOT_FOUND, "처리할 전달 건을 찾을 수 없습니다.");

    private final HttpStatus status;
    private final String message;

    OutboxErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

package com.oneorthree.business.common.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 모든 예외를 {@link ErrorResponse} 봉투 하나로 바꿔 내보낸다.
 *
 * <p><b>가장 중요한 규칙: 상류의 도메인 판정은 재해석하지 않는다.</b> {@link UpstreamDomainException}
 * 은 status·code·message·retryAfterMs 를 그대로 통과시킨다 — 앱이 그 문자열로 분기하고 있어서다.
 * 나머지 상류 실패(응답 없음 · 자격 거절 · 계약 어긋남)는 서로 <b>구분해서</b> 올린다. 한 덩어리로
 * 접으면 「장애」와 「배선 사고」와 「거부」가 같은 응답이 되어 운영에서 가려낼 수 없다.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 상류 도메인 판정 중계 — 봉투를 통째로 전달한다. */
    @ExceptionHandler(UpstreamDomainException.class)
    public ResponseEntity<ErrorResponse> handleUpstreamDomain(UpstreamDomainException e) {
        HttpStatus status = e.resolvedStatus();
        if (e.getRetryAfterMs() != null) {
            return ResponseEntity.status(status).body(
                    new RetryAfterErrorResponse(e.getCode(), e.getUpstreamMessage(), e.getRetryAfterMs()));
        }
        return ResponseEntity.status(status).body(new ErrorResponse(e.getCode(), e.getUpstreamMessage()));
    }

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ErrorResponse> handleDomain(DomainException e) {
        return body(e.getErrorCode());
    }

    @ExceptionHandler(UpstreamUnavailableException.class)
    public ResponseEntity<ErrorResponse> handleUnavailable(UpstreamUnavailableException e) {
        log.warn("상류 응답 없음 — {}", e.getMessage());
        return body(CommonErrorCode.UPSTREAM_UNAVAILABLE);
    }

    /** ⚠️ 토큰 값은 로그에 넣지 않는다 — 메시지는 caller·대상까지만 담는다. */
    @ExceptionHandler(UpstreamCredentialRejectedException.class)
    public ResponseEntity<ErrorResponse> handleCredentialRejected(UpstreamCredentialRejectedException e) {
        log.error("상류가 서비스 자격을 거절했다 — {}", e.getMessage());
        return body(CommonErrorCode.UPSTREAM_CREDENTIAL_REJECTED);
    }

    @ExceptionHandler(UpstreamContractMismatchException.class)
    public ResponseEntity<ErrorResponse> handleContractMismatch(UpstreamContractMismatchException e) {
        log.error("상류 계약 불일치 — {}", e.getMessage());
        return body(CommonErrorCode.UPSTREAM_CONTRACT_MISMATCH);
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<ErrorResponse> handleInvalidBody(Exception e) {
        log.debug("요청 본문 거절 — {}", e.getClass().getSimpleName());
        return body(CommonErrorCode.INVALID_REQUEST);
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MissingRequestHeaderException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ErrorResponse> handleInvalidParameter(Exception e) {
        log.debug("요청 파라미터 거절 — {}", e.getClass().getSimpleName());
        return body(CommonErrorCode.INVALID_PARAMETER);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMediaType(HttpMediaTypeNotSupportedException e) {
        return body(CommonErrorCode.UNSUPPORTED_MEDIA_TYPE);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethod(HttpRequestMethodNotSupportedException e) {
        return body(CommonErrorCode.METHOD_NOT_ALLOWED);
    }

    /**
     * 매핑되지 않은 경로 — <b>404 이지 500 이 아니다</b>.
     *
     * <p>이 핸들러가 없으면 아래 {@code Exception} 그물에 걸려 500 이 되고, 그러면 라우팅·포트 설정
     * 문제가 「서버 장애」로 보인다. 관리 포트(9091)로 격리한 {@code /actuator/*} 를 서비스 포트로
     * 부르는 것이 정확히 그 경우다 — 격리가 정상 동작한 것인데 500 은 그 사실을 가린다.
     */
    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<ErrorResponse> handleNotFound(Exception e) {
        log.debug("매핑되지 않은 경로 — {}", e.getClass().getSimpleName());
        return body(CommonErrorCode.ENDPOINT_NOT_FOUND);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        log.error("처리하지 못한 예외", e);
        return body(CommonErrorCode.INTERNAL_ERROR);
    }

    private ResponseEntity<ErrorResponse> body(ErrorCode code) {
        return ResponseEntity.status(code.getStatus())
                .body(new ErrorResponse(code.name(), code.getMessage()));
    }
}

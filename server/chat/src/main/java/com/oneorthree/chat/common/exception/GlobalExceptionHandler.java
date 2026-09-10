package com.oneorthree.chat.common.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * REST 경로의 모든 예외를 봉투 {@code {code, message}} 하나로 바꾼다.
 *
 * <p><b>도메인마다 핸들러를 두지 않는다.</b> 새 도메인이 생기면 {@link ErrorCode} 를 구현한 enum 과
 * {@link DomainException} 을 상속한 예외를 만들면 되고, 여기는 손대지 않는다.
 *
 * <p>STOMP 경로는 이 핸들러가 닿지 않는다 — 그쪽은 서블릿이 아니라 메시지 채널이라
 * {@code @MessageExceptionHandler} 가 같은 일을 한다. 봉투 모양은 일부러 같게 맞춘다.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 우리가 «의도적으로» 거절한 것 — 규칙대로 동작한 결과다.
     *
     * <p>그래서 스택트레이스를 남기지 않는다. 집중 중 차단·비멤버 차단은 정상 운영에서 늘 일어나는
     * 일이라 error 로 찍으면 대시보드가 노이즈로 덮이고, 정작 진짜 고장이 묻힌다.
     */
    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ErrorResponse> handleDomain(DomainException e) {
        ErrorCode code = e.getErrorCode();
        log.debug("도메인 거절 — code={}", code.name());
        return ResponseEntity.status(code.getStatus()).body(ErrorResponse.from(code));
    }

    /**
     * 요청이 형식을 어긴 경우 전부 — {@code @Valid} 위반, 경로·파라미터 타입 불일치, 깨진 JSON 본문,
     * 필수 헤더 누락.
     *
     * <p>타입 불일치를 여기 넣는 것이 중요하다. {@code @PathVariable UUID groupId} 에 UUID 가 아닌 값이
     * 오면({@code /rooms/abc/messages}) Spring 이
     * {@code MethodArgumentTypeMismatchException} 을 던지는데, 이걸 따로 안 잡으면 아래 그물에 걸려
     * <b>400 이어야 할 것이 500 으로 나간다</b> — 클라이언트 실수가 서버 장애로 보이고, 로그에는
     * 스택트레이스가 쌓여 진짜 고장이 묻힌다.
     *
     * <p>어느 필드가 왜 틀렸는지는 로그에만 남긴다. 본문에 실으면 내부 필드명·타입이 샌다.
     */
    @ExceptionHandler({
            MethodArgumentNotValidException.class,
            MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class,
            MissingRequestHeaderException.class,
    })
    public ResponseEntity<ErrorResponse> handleBadRequest(Exception e) {
        log.debug("요청 형식 오류 — {}: {}", e.getClass().getSimpleName(), e.getMessage());
        return ResponseEntity.status(CommonErrorCode.INVALID_REQUEST.getStatus())
                .body(ErrorResponse.from(CommonErrorCode.INVALID_REQUEST));
    }

    /**
     * 그물 — 위에서 안 잡힌 전부. <b>Spring 이 이미 상태를 정한 것과, 우리가 몰랐던 고장을 가른다.</b>
     *
     * <h3>왜 {@code instanceof ErrorResponse} 인가</h3>
     * 매핑 없는 경로는 Spring 7 에서 {@code NoResourceFoundException} 으로 오는데, 그 타입은
     * {@code ErrorResponseException} 을 <b>상속하지 않고</b> {@code ErrorResponse} 인터페이스를
     * <b>구현</b>한다. 그래서 예외 타입으로 잡으려면 {@code NoResourceFoundException} ·
     * {@code HttpRequestMethodNotSupportedException} · {@code HttpMediaTypeNotSupportedException} …
     * 을 일일이 열거해야 하고, 그 목록은 Spring 이 예외를 하나 더 정의할 때마다 조용히 낡는다.
     * 인터페이스로 가르면 «상태를 스스로 아는 예외»가 전부 한 갈래로 들어온다.
     *
     * <h3>안 가르면 무슨 일이 나는가</h3>
     * 모든 404 가 <b>500 + error 레벨 스택트레이스</b>가 된다. 컨테이너를 실제로 띄워 보고서야
     * 드러났다 — {@code /actuator/health} 를 본 포트로 치는 흔한 실수 하나, 스캐너의 임의 경로 하나가
     * 「서버 장애」로 기록되고, 그 노이즈에 진짜 고장이 묻힌다.
     *
     * <p>상태는 Spring 이 정한 것을 그대로 쓴다 — 우리가 다시 판단하면 405·415 가 뭉뚱그려진다.
     * 봉투의 {@code code} 만 우리 어휘로 바꾼다. 본문에는 원인 문자열을 절대 싣지 않는다:
     * 예외 메시지에는 SQL·호스트·키 이름이 섞여 나오고, 그게 그대로 화면과 로그 수집기에 실린다.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnhandled(Exception e) {
        // 정규화된 이름을 쓴다 — 임포트하면 우리 ErrorResponse 와 단순 이름이 겹쳐 이 파일 전체가 깨진다.
        if (e instanceof org.springframework.web.ErrorResponse springWebError) {
            HttpStatusCode status = springWebError.getStatusCode();
            CommonErrorCode code = status.value() == HttpStatus.NOT_FOUND.value()
                    ? CommonErrorCode.NOT_FOUND
                    : (status.is4xxClientError()
                            ? CommonErrorCode.INVALID_REQUEST
                            : CommonErrorCode.INTERNAL_ERROR);

            // 클라이언트 실수는 debug 다 — 스택트레이스를 남기면 그게 곧 노이즈다.
            log.debug("웹 예외 — status={} {}", status.value(), e.getClass().getSimpleName());
            return ResponseEntity.status(status).body(ErrorResponse.from(code));
        }

        // 여기 걸린 건 «우리가 몰랐던 고장»이므로 스택트레이스를 남긴다.
        log.error("처리되지 않은 예외", e);
        return ResponseEntity.status(CommonErrorCode.INTERNAL_ERROR.getStatus())
                .body(ErrorResponse.from(CommonErrorCode.INTERNAL_ERROR));
    }
}
